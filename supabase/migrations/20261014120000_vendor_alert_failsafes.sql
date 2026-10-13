-- Vendor alerts that don't depend on one WhatsApp number.
--
-- Until now a vendor learned about a booking or a delivery only by
-- looking at their SendEbun link, or from the recipient's own WhatsApp
-- message. Lose the phone, change the number, mute the chat — and a paid
-- gift sits unseen. Three layers now, each independent of the others:
--
--   1. Email to the vendor (vendors.email) the moment a delivery is
--      assigned or a pickup is booked. Sent via Resend; logged in
--      public.notifications like every other outbound message.
--   2. A second number (backup_phone) — a manager, a partner, the shop
--      landline — for ops to call when the first goes quiet.
--   3. Escalation: anything unacknowledged after 30 minutes gets a
--      reminder to the vendor and an email to ops, and sits at the top
--      of /ops until someone deals with it.

alter table public.vendors
  add column backup_phone text
    check (backup_phone is null or backup_phone ~ '^\+[1-9][0-9]{6,14}$');

comment on column public.vendors.backup_phone is
  'Second contact (E.164) for when the WhatsApp number goes quiet — a manager, partner or shop line. Ops-facing only.';

-- The escalation sweep: unconfirmed pickups by when they were booked.
create index idx_orders_pickup_unconfirmed
  on public.orders (pickup_booked_at)
  where pickup_vendor_id is not null and pickup_confirmed_at is null;
