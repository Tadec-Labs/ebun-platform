import type { GiftCategory } from '@ebun/types';

/**
 * How long before a booked visit a gift may be booked, in minutes.
 * Agreed with partners on 24 Oct 2026: a spa needs 6 hours to free a
 * therapist, a cinema 3 hours to hold seats, a kitchen nothing (booking
 * is only a heads-up so the food is ready). A gift's own
 * min_notice_minutes overrides the category default.
 *
 * Applied by hiding earlier times in the recipient's picker and refusing
 * them on the server — never as an extra step or a message to read.
 */
const CATEGORY_DEFAULT_MINUTES: Partial<Record<GiftCategory, number>> = {
  pamper: 6 * 60,
  experiences: 3 * 60,
};

export function minNoticeMinutes(template: {
  category: GiftCategory;
  min_notice_minutes?: number | null;
}): number {
  if (
    typeof template.min_notice_minutes === 'number' &&
    template.min_notice_minutes >= 0
  ) {
    return template.min_notice_minutes;
  }
  return CATEGORY_DEFAULT_MINUTES[template.category] ?? 0;
}
