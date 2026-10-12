/**
 * Cloudflare R2 settings for PUBLIC photos (gift pictures).
 *
 * Why R2: downloads are free. A gift photo is fetched on every /send and
 * every reveal, so egress is the cost that would grow; on R2 it doesn't
 * exist. Storage is tiny once photos are compressed on the phone.
 *
 * Optional at boot, like Termii: the API must start for anyone not
 * working on photos. Photo uploads answer 503 until it is configured.
 * But half-configured is refused at boot — four of five variables set is
 * a typo, and finding it at the first vendor upload is too late.
 */
export interface R2PublicConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** e.g. https://pub-xxxx.r2.dev or https://img.ebun.com.ng — no trailing slash. */
  publicBaseUrl: string;
}

const VARIABLES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BUCKET',
  'R2_PUBLIC_BASE_URL',
] as const;

export function resolveR2PublicConfig(
  env: NodeJS.ProcessEnv = process.env,
): R2PublicConfig | null {
  const values = VARIABLES.map((name) => [name, env[name]?.trim() ?? '']);
  const missing = values.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length === VARIABLES.length) return null;
  if (missing.length > 0) {
    throw new Error(
      `Cloudflare R2 is partly configured. Missing: ${missing.join(', ')}`,
    );
  }

  const get = (name: (typeof VARIABLES)[number]) =>
    values.find(([key]) => key === name)![1];

  const publicBaseUrl = get('R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (!/^https:\/\//.test(publicBaseUrl)) {
    throw new Error('R2_PUBLIC_BASE_URL must start with https://');
  }

  return {
    accountId: get('R2_ACCOUNT_ID'),
    accessKeyId: get('R2_ACCESS_KEY_ID'),
    secretAccessKey: get('R2_SECRET_ACCESS_KEY'),
    bucket: get('R2_PUBLIC_BUCKET'),
    publicBaseUrl,
  };
}
