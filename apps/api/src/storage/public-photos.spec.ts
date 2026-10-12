import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { resolveR2PublicConfig } from './r2.config';
import {
  MAX_PHOTO_BYTES,
  PublicPhotosService,
  sniffImageType,
} from './public-photos.service';

const ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_PUBLIC_BUCKET: 'sendebun-public',
  R2_PUBLIC_BASE_URL: 'https://pub-abc.r2.dev/',
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
]);
const photo = (buffer: Buffer) => ({ buffer, size: buffer.length });

describe('resolveR2PublicConfig', () => {
  it('is off when nothing is set — the API still boots', () => {
    expect(resolveR2PublicConfig({})).toBeNull();
  });

  it('refuses a half-configured setup at boot', () => {
    expect(() =>
      resolveR2PublicConfig({ ...ENV, R2_PUBLIC_BUCKET: '' }),
    ).toThrow(/R2_PUBLIC_BUCKET/);
  });

  it('drops a trailing slash from the public address', () => {
    expect(resolveR2PublicConfig(ENV)?.publicBaseUrl).toBe(
      'https://pub-abc.r2.dev',
    );
  });

  it('refuses a public address that is not https', () => {
    expect(() =>
      resolveR2PublicConfig({ ...ENV, R2_PUBLIC_BASE_URL: 'http://x.dev' }),
    ).toThrow(/https/);
  });
});

describe('sniffImageType', () => {
  it('knows JPEG, PNG and WebP from their first bytes', () => {
    expect(sniffImageType(JPEG)?.extension).toBe('jpg');
    expect(sniffImageType(PNG)?.extension).toBe('png');
    expect(sniffImageType(WEBP)?.extension).toBe('webp');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(sniffImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('PublicPhotosService', () => {
  const saved = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    process.env = { ...saved };
    fetchSpy.mockRestore();
  });

  const configured = () => {
    Object.assign(process.env, ENV);
    return new PublicPhotosService();
  };

  it('stores a photo under a random key with its real type and a long cache, and returns its public URL', async () => {
    const url = await configured().upload(photo(JPEG), 'gifts');

    expect(url).toMatch(
      /^https:\/\/pub-abc\.r2\.dev\/gifts\/[0-9a-f-]{36}\.jpg$/,
    );
    const [request] = fetchSpy.mock.calls[0] as [Request];
    expect(request.method).toBe('PUT');
    expect(request.url).toMatch(
      /^https:\/\/acct123\.r2\.cloudflarestorage\.com\/sendebun-public\/gifts\/.+\.jpg$/,
    );
    expect(request.headers.get('content-type')).toBe('image/jpeg');
    expect(request.headers.get('cache-control')).toContain('immutable');
    // Signed, never sent with the raw secret
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256/);
    expect(request.headers.get('authorization')).not.toContain('secret');
  });

  it('refuses a file that is not really an image, before touching R2', async () => {
    await expect(
      configured().upload(photo(Buffer.from('<html>')), 'gifts'),
    ).rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an oversized photo', async () => {
    await expect(
      configured().upload({ buffer: JPEG, size: MAX_PHOTO_BYTES + 1 }, 'gifts'),
    ).rejects.toThrow(/too large/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 503, with a way forward, when R2 is not configured', async () => {
    for (const key of Object.keys(ENV)) delete process.env[key];
    await expect(
      new PublicPhotosService().upload(photo(PNG), 'gifts'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('reports a failed save instead of returning a URL to nothing', async () => {
    fetchSpy.mockResolvedValue(new Response('denied', { status: 403 }));
    await expect(configured().upload(photo(PNG), 'gifts')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('deletes only photos it stored itself', async () => {
    const sut = configured();

    await sut.deleteIfOurs('https://example.com/someone-elses.jpg');
    await sut.deleteIfOurs('https://pub-abc.r2.dev/../../etc/passwd');
    expect(fetchSpy).not.toHaveBeenCalled();

    await sut.deleteIfOurs(
      'https://pub-abc.r2.dev/gifts/11111111-1111-4111-8111-111111111111.webp',
    );
    const [request] = fetchSpy.mock.calls[0] as [Request];
    expect(request.method).toBe('DELETE');
  });

  it('never throws from a delete — a leftover photo costs less than a failed save', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    await expect(
      configured().deleteIfOurs(
        'https://pub-abc.r2.dev/gifts/11111111-1111-4111-8111-111111111111.jpg',
      ),
    ).resolves.toBeUndefined();
  });
});
