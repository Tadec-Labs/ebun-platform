import {
  computeServiceFee,
  DEFAULT_SERVICE_FEE_POLICY,
  resolveServiceFeePolicy,
} from './service-fee';

const naira = (n: number) => n * 100;

describe('computeServiceFee (default policy: 5%, ₦200–₦1,500)', () => {
  const fee = (giftNaira: number) =>
    computeServiceFee(naira(giftNaira), DEFAULT_SERVICE_FEE_POLICY);

  it('charges 5% in the normal range', () => {
    expect(fee(8_000)).toBe(naira(400));
  });

  it('applies the ₦200 floor to small gifts', () => {
    expect(fee(2_000)).toBe(naira(200));
  });

  it('applies the ₦1,500 ceiling to large gifts', () => {
    expect(fee(50_000)).toBe(naira(1_500));
  });

  it('rounds up to a whole naira, never down', () => {
    // 5% of ₦8,010 is ₦400.50
    expect(fee(8_010)).toBe(naira(401));
  });

  it('charges nothing on a zero-value gift', () => {
    expect(fee(0)).toBe(0);
  });

  it('charges nothing at all when the rate is 0, floor included', () => {
    expect(
      computeServiceFee(naira(8_000), {
        ...DEFAULT_SERVICE_FEE_POLICY,
        rateBps: 0,
      }),
    ).toBe(0);
  });
});

describe('resolveServiceFeePolicy', () => {
  it('uses the defaults when nothing is set', () => {
    expect(resolveServiceFeePolicy({})).toEqual(DEFAULT_SERVICE_FEE_POLICY);
  });

  it('reads overrides', () => {
    expect(
      resolveServiceFeePolicy({
        SERVICE_FEE_BPS: '300',
        SERVICE_FEE_MIN_KOBO: '10000',
        SERVICE_FEE_MAX_KOBO: '100000',
      }),
    ).toEqual({ rateBps: 300, minKobo: 10_000, maxKobo: 100_000 });
  });

  it('refuses a rate that looks like a percent typed into basis points', () => {
    expect(() => resolveServiceFeePolicy({ SERVICE_FEE_BPS: '5000' })).toThrow(
      /basis points/,
    );
  });

  it('refuses malformed numbers rather than defaulting', () => {
    expect(() => resolveServiceFeePolicy({ SERVICE_FEE_BPS: '5%' })).toThrow(
      /SERVICE_FEE_BPS/,
    );
    expect(() =>
      resolveServiceFeePolicy({ SERVICE_FEE_MIN_KOBO: '-1' }),
    ).toThrow(/SERVICE_FEE_MIN_KOBO/);
  });

  it('refuses a ceiling below the floor', () => {
    expect(() =>
      resolveServiceFeePolicy({
        SERVICE_FEE_MIN_KOBO: '50000',
        SERVICE_FEE_MAX_KOBO: '20000',
      }),
    ).toThrow(/below/);
  });
});
