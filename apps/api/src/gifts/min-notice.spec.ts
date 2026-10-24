import { minNoticeMinutes } from './min-notice';

describe('minNoticeMinutes', () => {
  it('uses the agreed defaults: spa 6h, cinema 3h, food none', () => {
    expect(minNoticeMinutes({ category: 'pamper' })).toBe(360);
    expect(minNoticeMinutes({ category: 'experiences' })).toBe(180);
    expect(minNoticeMinutes({ category: 'dine' })).toBe(0);
  });

  it("lets a gift's own setting override the category, including zero", () => {
    expect(
      minNoticeMinutes({ category: 'pamper', min_notice_minutes: 0 }),
    ).toBe(0);
    expect(minNoticeMinutes({ category: 'dine', min_notice_minutes: 60 })).toBe(
      60,
    );
    expect(
      minNoticeMinutes({ category: 'pamper', min_notice_minutes: null }),
    ).toBe(360);
  });
});
