import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AwsClient } from 'aws4fetch';
import { R2PublicConfig, resolveR2PublicConfig } from './r2.config';

/** What an upload handler receives — the subset of a multer file this uses. */
export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

/**
 * The web app shrinks photos on the phone to ~1200px before upload, so a
 * real one is ~100–300 KB. 1 MB leaves room for an unusually detailed
 * picture while refusing an uncompressed 5 MB camera original, which is
 * the thing that would make storage grow.
 */
export const MAX_PHOTO_BYTES = 1_000_000;

/** Year-long caching: every photo gets a new key, so a URL never changes meaning. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Stores gift photos in the public R2 bucket.
 *
 * Uploads pass through the API rather than going straight from the phone
 * to R2 with a pre-signed link. A photo is ~200 KB after compression, so
 * the bandwidth is nothing — and in exchange the server checks what it is
 * storing: the file's real type from its first bytes (not the name or the
 * header the phone claims), and its size. A pre-signed upload can't check
 * either. It also means no keys and no CORS rule are involved in the
 * upload path.
 */
@Injectable()
export class PublicPhotosService {
  private readonly logger = new Logger(PublicPhotosService.name);
  private readonly config: R2PublicConfig | null;
  private readonly client: AwsClient | null;

  constructor() {
    this.config = resolveR2PublicConfig();
    this.client = this.config
      ? new AwsClient({
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
          service: 's3',
          region: 'auto',
        })
      : null;
  }

  /** Stores the photo under `prefix/` and returns its public URL. */
  async upload(photo: UploadedPhoto, prefix: 'gifts'): Promise<string> {
    const { config, client } = this.requireConfigured();

    if (photo.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException(
        'That photo is too large. Please use a smaller one.',
      );
    }
    const type = sniffImageType(photo.buffer);
    if (!type) {
      throw new BadRequestException(
        'That file is not a photo we can use. Please choose a JPEG, PNG or WebP picture.',
      );
    }

    const key = `${prefix}/${randomUUID()}.${type.extension}`;
    const response = await client.fetch(this.objectUrl(config, key), {
      method: 'PUT',
      body: new Uint8Array(photo.buffer),
      headers: {
        'Content-Type': type.contentType,
        'Cache-Control': CACHE_CONTROL,
      },
    });
    if (!response.ok) {
      this.logger.error(
        `R2 upload of ${key} failed: ${response.status} ${await response.text().catch(() => '')}`,
      );
      throw new ServiceUnavailableException(
        "Couldn't save the photo just now. Please try again.",
      );
    }

    return `${config.publicBaseUrl}/${key}`;
  }

  /**
   * Removes a photo SendEbun stored, when it is replaced — so old photos
   * don't pile up. Ignores URLs that aren't ours (e.g. a link pasted in
   * /ops before uploads existed) and never throws: a photo left behind
   * costs a fraction of a kobo; a failed save over it would cost a vendor.
   */
  async deleteIfOurs(url: string | null | undefined): Promise<void> {
    if (!url || !this.config || !this.client) return;
    const prefix = `${this.config.publicBaseUrl}/`;
    if (!url.startsWith(prefix)) return;

    const key = url.slice(prefix.length);
    if (!/^[a-z]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return;

    try {
      const response = await this.client.fetch(
        this.objectUrl(this.config, key),
        { method: 'DELETE' },
      );
      if (!response.ok && response.status !== 404) {
        this.logger.warn(`R2 delete of ${key} answered ${response.status}`);
      }
    } catch (err) {
      this.logger.warn(
        `R2 delete of ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private objectUrl(config: R2PublicConfig, key: string): string {
    return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  }

  private requireConfigured(): { config: R2PublicConfig; client: AwsClient } {
    if (!this.config || !this.client) {
      throw new ServiceUnavailableException(
        "Photo upload isn't switched on yet. Send the photo to SendEbun on WhatsApp instead.",
      );
    }
    return { config: this.config, client: this.client };
  }
}

/**
 * The file's real type, from its first bytes. A phone (or anyone) can
 * label any file "image/jpeg"; the bytes can't lie about being a JPEG.
 */
export function sniffImageType(
  buffer: Buffer,
): { extension: 'jpg' | 'png' | 'webp'; contentType: string } | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}
