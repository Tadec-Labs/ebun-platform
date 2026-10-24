-- Partner terms: the rules SendEbun promises partners, backed by the
-- product. Agreed with the founder on 24 Oct 2026. Every rule here acts
-- only when something goes wrong; the normal send / reveal / collect
-- flow gains no steps.
--
--   1. Minimum notice for bookings (spa 6h, cinema 3h, food none).
--   2. Missed bookings: the partner taps "Didn't come"; the recipient
--      rebooks once for free. A second miss is flagged to ops, whose rule
--      is that the gift then counts as used and the partner is paid.
--   3. Failed delivery: the partner taps "Couldn't deliver"; the gift
--      becomes collect-at-the-shop with the same 4-digit code. A second
--      doorstep trip is ops' call, never automatic.
--   4. Doorstep gifts whose address never arrives expire with the gift
--      (30 days) for refund, and the sender is nudged twice before that.
--   5. The sender may give the address up front, so the recipient skips
--      that screen entirely.

-- 1. Per-gift override. Null = the category default in the API
--    (pamper 360, experiences 180, everything else 0).
alter table public.gift_templates
  add column min_notice_minutes integer
    check (min_notice_minutes between 0 and 10080);

comment on column public.gift_templates.min_notice_minutes is
  'Earliest a recipient may book, in minutes from now. Null = category default (pamper 6h, experiences 3h, else none).';

-- 2. Missed bookings on collected gifts.
alter table public.orders
  add column pickup_no_shows smallint not null default 0;

comment on column public.orders.pickup_no_shows is
  'Times the partner marked a booked visit as "Didn''t come". One free rebook; at two, ops is alerted.';

-- 3. Failed doorstep delivery.
alter table public.orders
  add column delivery_failed_at     timestamptz,
  add column delivery_failed_reason text check (char_length(delivery_failed_reason) <= 300);

comment on column public.orders.delivery_failed_at is
  'The partner (or ops) could not hand a doorstep gift over. The gift is then collected at the shop with the same handover code.';

-- 4. Nudging the sender while no address has come in.
alter table public.orders
  add column address_nudges    smallint not null default 0,
  add column address_nudged_at timestamptz;

comment on column public.orders.address_nudges is
  'Emails sent to the sender because the recipient has not given a delivery address yet (at most 2: day 1 and day 3).';

create index idx_orders_awaiting_address
  on public.orders (created_at)
  where delivery_address is null and status = 'fulfillment_in_progress';
