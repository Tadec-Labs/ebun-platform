import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MAX_MEDIA_BYTES,
  MessageMediaService,
  sniffMediaType,
} from './message-media.service';
import { resolveR2MediaConfig } from './r2-media.config';

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypmp42', 'ascii'),
]);
const OGG = Buffer.from('OggS\u0000\u0002', 'binary');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_MEDIA_BUCKET: 'sendebun-media',
};

describe('resolveR2MediaConfig', () => {
  it('is off without a media bucket, so the API still boots', () => {
    expect(resolveR2MediaConfig({})).toBeNull();
  });

  it('refuses a media bucket with no credentials', () => {
    expect(() =>
      resolveR2MediaConfig({ R2_MEDIA_BUCKET: 'sendebun-media' }),
    ).toThrow(/R2_ACCOUNT_ID/);
  });
});

describe('sniffMediaType', () => {
  it('recognises what phones record, labelled by the kind the sender chose', () => {
    expect(sniffMediaType(WEBM, 'voice')).toEqual({
      extension: 'webm',
      contentType: 'audio/webm',
    });
    expect(sniffMediaType(WEBM, 'video')?.contentType).toBe('video/webm');
    expect(sniffMediaType(MP4, 'video')).toEqual({
      extension: 'mp4',
      contentType: 'video/mp4',
    });
    expect(sniffMediaType(OGG, 'voice')?.contentType).toBe('audio/ogg');
  });

  it('refuses anything else, whatever it claims to be', () => {
    expect(sniffMediaType(JPEG, 'voice')).toBeNull();
    expect(sniffMediaType(OGG, 'video')).toBeNull();
    expect(sniffMediaType(Buffer.alloc(0), 'voice')).toBeNull();
  });
});

describe('MessageMediaService', () => {
  const saved = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    Object.assign(process.env, ENV);
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...saved };
  });

  it('stores a recording under messages/ in the private bucket, never publicly cached', async () => {
    const sut = new MessageMediaService();

    const key = await sut.store('voice', { buffer: WEBM, size: WEBM.length });

    expect(key).toMatch(/^messages\/[0-9a-f-]{36}\.webm$/);
    const request = (fetchSpy.mock.calls as unknown[][])[0][0] as Request;
    expect(request.url).toBe(
      `https://acct123.r2.cloudflarestorage.com/sendebun-media/${key}`,
    );
    expect(request.method).toBe('PUT');
    expect(request.headers.get('content-type')).toBe('audio/webm');
    expect(request.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses an oversized voice note, and a file that is not a recording, before uploading', async () => {
    const sut = new MessageMediaService();

    await expect(
      sut.store('voice', { buffer: WEBM, size: MAX_MEDIA_BYTES.voice + 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      sut.store('voice', { buffer: JPEG, size: JPEG.length }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns an unreachable R2 into a "try again", never a 500', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    const sut = new MessageMediaService();

    await expect(
      sut.store('voice', { buffer: WEBM, size: WEBM.length }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('turns an R2 refusal into the same "try again"', async () => {
    fetchSpy.mockResolvedValue(new Response('denied', { status: 403 }));
    const sut = new MessageMediaService();

    await expect(
      sut.store('video', { buffer: WEBM, size: WEBM.length }),
    ).rejects.toThrow(/Couldn't save your recording/);
  });

  it('hands out a signed link that expires in two hours', async () => {
    const sut = new MessageMediaService();

    const url = new URL(
      (await sut.playbackUrl(
        'messages/0b6c3f7a-1d2e-4f5a-9b8c-7d6e5f4a3b2c.webm',
      )) as string,
    );

    expect(url.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('7200');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchSpy).not.toHaveBeenCalled(); // signing is local, no request
  });

  it("won't sign something that isn't one of our message keys", async () => {
    const sut = new MessageMediaService();

    await expect(sut.playbackUrl('gifts/photo.webp')).resolves.toBeNull();
    await expect(
      sut.playbackUrl('https://evil.example/x.webm'),
    ).resolves.toBeNull();
  });

  it('turns voice and video off cleanly when the bucket is not configured', async () => {
    delete process.env.R2_MEDIA_BUCKET;
    const sut = new MessageMediaService();

    expect(sut.isEnabled()).toBe(false);
    await expect(
      sut.playbackUrl('messages/0b6c3f7a-1d2e-4f5a-9b8c-7d6e5f4a3b2c.webm'),
    ).resolves.toBeNull();
    await expect(
      sut.store('voice', { buffer: WEBM, size: WEBM.length }),
    ).rejects.toThrow(/aren't available/);
  });
});
