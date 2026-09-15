/**
 * Resolves a private Cloudflare R2 object path into a short-lived,
 * publicly-fetchable playback URL. "Media storage: Cloudflare R2
 * (presigned URLs, private by default)" is a settled architecture
 * decision — orders.message_url is a path into a PRIVATE bucket, not a
 * directly fetchable URL. Something has to turn it into a presigned GET
 * URL before a recipient's browser can play it back.
 *
 * NOT IMPLEMENTED YET — same reasoning and same shape as
 * VtuProviderService: I don't have R2 account credentials
 * (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 * R2_BUCKET_NAME) in this session, and guessing at bucket/key
 * conventions risks building against the wrong shape. RevealService is
 * written against this interface so a real R2Client-backed
 * implementation (via @aws-sdk/client-s3's S3 presigner, which is how
 * R2's S3-compatible API is normally driven from Node) is a one-line
 * change in RevealModule's providers array.
 */
export interface MediaUrlResolver {
  resolvePlaybackUrl(privateMessageUrl: string): Promise<string>;
}

export const MEDIA_URL_RESOLVER = Symbol('MEDIA_URL_RESOLVER');
