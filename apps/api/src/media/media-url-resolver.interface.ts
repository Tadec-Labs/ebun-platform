/**
 * Turns the private R2 object key stored on an order (orders.message_url)
 * into a short-lived link the recipient's browser can play. "Media
 * storage: Cloudflare R2 (presigned URLs, private by default)" is a
 * settled architecture decision — the stored value is never itself
 * fetchable.
 *
 * Null means "no playable link": storage isn't configured, or the stored
 * value isn't one of our keys. The reveal page then shows no player
 * rather than a broken one.
 */
export interface MediaUrlResolver {
  resolvePlaybackUrl(privateMessageKey: string): Promise<string | null>;
}

export const MEDIA_URL_RESOLVER = Symbol('MEDIA_URL_RESOLVER');
