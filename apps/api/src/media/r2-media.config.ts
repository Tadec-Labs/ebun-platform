/**
 * Cloudflare R2 settings for the PRIVATE bucket that holds senders' voice
 * and video messages.
 *
 * A separate bucket from gift photos on purpose. Photos are meant to be
 * seen by anyone; a message is meant for one person. Nothing in this
 * bucket has a public URL: the API stores it, and hands the recipient a
 * link that expires (see MessageMediaService.playbackUrl).
 *
 * Shares the account and API keys with the photo bucket (R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) — the API token must be allowed
 * to read and write this bucket too. R2_MEDIA_BUCKET unset means voice
 * and video are off; the API still boots and text messages still work.
 */
export interface R2MediaConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function resolveR2MediaConfig(
  env: NodeJS.ProcessEnv = process.env,
): R2MediaConfig | null {
  const bucket = env.R2_MEDIA_BUCKET?.trim() ?? '';
  if (!bucket) return null;

  const accountId = env.R2_ACCOUNT_ID?.trim() ?? '';
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? '';
  const missing = [
    ['R2_ACCOUNT_ID', accountId],
    ['R2_ACCESS_KEY_ID', accessKeyId],
    ['R2_SECRET_ACCESS_KEY', secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    // Refused at boot: R2_MEDIA_BUCKET set without credentials is a
    // half-finished setup, and the first sender to record a message
    // would be the one to find it.
    throw new Error(
      `R2_MEDIA_BUCKET is set but Cloudflare R2 credentials are missing: ${missing.join(', ')}`,
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket };
}
