/**
 * How many reverse proxies sit in front of the API — Express's
 * `trust proxy` setting.
 *
 * Why it matters: on Railway every request arrives from Railway's edge
 * proxy. Without this, request.ip is the proxy's address for EVERY
 * customer, which breaks two things silently:
 *   - rate limiting counts all customers as one client, so one busy
 *     minute throttles everyone (or one abuser is indistinguishable
 *     from the crowd);
 *   - the sender_ip recorded on orders for fraud review is useless.
 *
 * Trusting a proxy that isn't there is also wrong: anyone could send a
 * forged X-Forwarded-For and choose their own IP. So it is never on by
 * default locally. TRUST_PROXY_HOPS sets it explicitly; failing that,
 * Railway's own RAILWAY_ENVIRONMENT variable implies its single edge hop,
 * so a deploy that forgets the setting is still correct.
 */
export function resolveTrustProxyHops(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (raw) {
    const hops = Number(raw);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
      throw new Error(
        `TRUST_PROXY_HOPS must be a whole number from 0 to 5: ${raw}`,
      );
    }
    return hops;
  }
  return env.RAILWAY_ENVIRONMENT ? 1 : 0;
}
