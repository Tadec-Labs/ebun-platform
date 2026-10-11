import { resolveTrustProxyHops } from './proxy';

describe('resolveTrustProxyHops', () => {
  it('trusts no proxy locally, so a forged X-Forwarded-For cannot choose an IP', () => {
    expect(resolveTrustProxyHops({})).toBe(0);
  });

  it("trusts Railway's single edge hop when running on Railway", () => {
    expect(resolveTrustProxyHops({ RAILWAY_ENVIRONMENT: 'production' })).toBe(
      1,
    );
  });

  it('lets an explicit setting win, including turning it off', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(
      resolveTrustProxyHops({
        TRUST_PROXY_HOPS: '0',
        RAILWAY_ENVIRONMENT: 'production',
      }),
    ).toBe(0);
  });

  it('refuses nonsense rather than guessing', () => {
    for (const bad of ['yes', '-1', '1.5', '9']) {
      expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: bad })).toThrow();
    }
  });
});
