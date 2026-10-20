import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AwsClient } from 'aws4fetch';
import { R2MediaConfig, resolveR2MediaConfig } from './r2-media.config';

export type MessageMediaKind = 'voice' | 'video';

/** What an upload handler receives — the subset of a multer file this uses. */
export interface UploadedMedia {
  buffer: Buffer;
  size: number;
}

/**
 * Size caps, checked on the server whatever the phone sends.
 *
 * The recorder asks for ~64 kbps audio and ~800 kbps video, which puts a
 * full 60 s voice note near 0.5 MB and a 30 s video near 3.5 MB. Some
 * phones (older iPhones especially) ignore the bitrate hint, so the caps
 * leave room — but refuse a raw camera file, which is what would make
 * storage and the recipient's data bill grow.
 */
export const MAX_MEDIA_BYTES: Record<MessageMediaKind, number> = {
  voice: 2_000_000,
  video: 15_000_000,
};

/** Recording limits from the Product Brief, plus a little slack for timer rounding. */
export const MAX_MEDIA_SECONDS: Record<MessageMediaKind, number> = {
  voice: 62,
  video: 32,
};

/**
 * How long a playback link works. Long enough to watch, rewatch and
 * pause mid-way; short enough that a link forwarded later is dead. The
 * reveal page asks for a fresh one each time it loads.
 */
const PLAYBACK_LINK_SECONDS = 2 * 60 * 60;

const KEY_PATTERN = /^messages\/[0-9a-f-]{36}\.(webm|mp4|ogg)$/;

/** Written and deleted at boot. Outside messages/, so it can never be signed for playback. */
const HEALTHCHECK_KEY = 'healthcheck/boot-write-test.txt';

/**
 * Senders' voice and video messages, in a PRIVATE R2 bucket.
 *
 * Uploads pass through the API, like gift photos (PublicPhotosService),
 * rather than going straight from the phone to R2: the server checks the
 * file's real type from its bytes and its size, which a pre-signed upload
 * can't, and no CORS rule or browser-visible key is involved. A message
 * is at most a few MB, so the extra hop costs nothing that matters.
 *
 * The order stores the object KEY, never a URL. A recipient gets a
 * link that expires (playbackUrl), and only through the reveal page,
 * which already requires their token.
 */
@Injectable()
export class MessageMediaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageMediaService.name);
  private readonly config: R2MediaConfig | null;
  private readonly client: AwsClient | null;

  constructor() {
    this.config = resolveR2MediaConfig();
    this.client = this.config
      ? new AwsClient({
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
          service: 's3',
          region: 'auto',
        })
      : null;
  }

  /** False until R2_MEDIA_BUCKET is set: voice and video are then refused with a clear message. */
  isEnabled(): boolean {
    return this.config !== null;
  }

  /**
   * At boot, proves the API can actually write to (and clean up in) the
   * media bucket, and says so in the logs either way.
   *
   * Why: a key that only covers the photos bucket boots happily and then
   * refuses every sender's recording with a 403 — found in October 2026
   * by testing checkout, not by a log. A misconfigured key now shows up
   * as one ERROR line at deploy time instead of at a customer's Pay
   * button.
   *
   * Never blocks or fails the boot: text messages, payments and
   * everything else work without the bucket. Not awaited by Nest's
   * bootstrap for the same reason.
   */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.checkWritable();
  }

  async checkWritable(): Promise<boolean> {
    if (!this.config || !this.client) return false;
    const url = this.objectUrl(this.config, HEALTHCHECK_KEY);
    try {
      const put = await this.client.fetch(url, {
        method: 'PUT',
        body: 'ok',
        headers: { 'Content-Type': 'text/plain' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!put.ok) {
        this.logger.error(
          `Media bucket "${this.config.bucket}" is NOT writable (${put.status}): voice and video messages will fail. Check the R2 API token covers this bucket with Object Read & Write.`,
        );
        return false;
      }
      await this.client
        .fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
        .catch(() => undefined);
      this.logger.log(`Media bucket "${this.config.bucket}" is writable.`);
      return true;
    } catch (err) {
      this.logger.error(
        `Media bucket check couldn't reach R2: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Checks and stores one recorded message. Returns its object key.
   * Throws 400 for anything that isn't a voice or video recording within
   * the limits, 503 if storage isn't set up or R2 refuses.
   */
  async store(kind: MessageMediaKind, media: UploadedMedia): Promise<string> {
    const { config, client } = this.requireConfigured();

    if (media.size > MAX_MEDIA_BYTES[kind]) {
      throw new BadRequestException(
        kind === 'voice'
          ? 'That voice note is too large. Please record a shorter one.'
          : 'That video is too large. Please record a shorter one.',
      );
    }
    const type = sniffMediaType(media.buffer, kind);
    if (!type) {
      throw new BadRequestException(
        kind === 'voice'
          ? "That recording isn't a voice note we can play. Please record it again."
          : "That recording isn't a video we can play. Please record it again.",
      );
    }

    const key = `messages/${randomUUID()}.${type.extension}`;
    let response: Response;
    try {
      response = await client.fetch(this.objectUrl(config, key), {
        method: 'PUT',
        body: new Uint8Array(media.buffer),
        headers: {
          'Content-Type': type.contentType,
          'Cache-Control': 'private, no-store',
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // Network failure or timeout: the sender gets the same "try again"
      // as a refusal from R2, not a 500.
      this.logger.error(
        `R2 upload of ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        "Couldn't save your recording just now. Please try again.",
      );
    }
    if (!response.ok) {
      this.logger.error(
        `R2 upload of ${key} failed: ${response.status} ${await response.text().catch(() => '')}`,
      );
      throw new ServiceUnavailableException(
        "Couldn't save your recording just now. Please try again.",
      );
    }
    return key;
  }

  /**
   * A link to one message that stops working after two hours. Null when
   * storage isn't configured or the stored value isn't one of our keys —
   * the reveal page then simply shows no player, rather than a broken one.
   */
  async playbackUrl(key: string): Promise<string | null> {
    if (!this.config || !this.client) return null;
    if (!KEY_PATTERN.test(key)) {
      this.logger.warn(`Not a message key, not signing it: ${key}`);
      return null;
    }
    const url = new URL(this.objectUrl(this.config, key));
    url.searchParams.set('X-Amz-Expires', String(PLAYBACK_LINK_SECONDS));
    const signed = await this.client.sign(url.toString(), {
      method: 'GET',
      aws: { signQuery: true },
    });
    return signed.url;
  }

  /** Best effort: an orphaned recording costs a fraction of a kobo; a crash here would cost an order. */
  async delete(key: string): Promise<void> {
    if (!this.config || !this.client || !KEY_PATTERN.test(key)) return;
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

  private objectUrl(config: R2MediaConfig, key: string): string {
    return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  }

  private requireConfigured(): { config: R2MediaConfig; client: AwsClient } {
    if (!this.config || !this.client) {
      throw new BadRequestException(
        "Voice and video messages aren't available just now. Please write your message instead.",
      );
    }
    return { config: this.config, client: this.client };
  }
}

/**
 * The recording's real container, from its first bytes. What browsers'
 * MediaRecorder produces: WebM (Chrome, Android, Firefox), MP4 (Safari,
 * iOS), occasionally Ogg (Firefox audio). The content type is set from
 * the kind the sender chose, so the player gets audio/* or video/*.
 */
export function sniffMediaType(
  buffer: Buffer,
  kind: MessageMediaKind,
): { extension: 'webm' | 'mp4' | 'ogg'; contentType: string } | null {
  const family = kind === 'voice' ? 'audio' : 'video';
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { extension: 'webm', contentType: `${family}/webm` };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  ) {
    return { extension: 'mp4', contentType: `${family}/mp4` };
  }
  if (
    kind === 'voice' &&
    buffer.length >= 4 &&
    buffer.subarray(0, 4).toString('ascii') === 'OggS'
  ) {
    return { extension: 'ogg', contentType: 'audio/ogg' };
  }
  return null;
}
