-- Collection gifts: the recipient books when they're coming, so the
-- vendor can have it ready.
--
-- Before this, a vendor learned about a gift only when the recipient
-- walked in with a code. Fine for a bottle of drink; useless for a pizza
-- that takes 30 minutes. Knowing at purchase doesn't help either — a
-- collection gift may be picked up an hour or three days later. What the
-- vendor needs is "who is coming, for what, and when".
--
-- These are facts about the order, not states: the order stays at
-- reveal_opened until collected. Booking (and re-booking) a time doesn't
-- change what the order IS, so the state machine is untouched.
--
--   pickup_vendor_id     where the recipient said they'll collect. May
--                        differ from orders.vendor_id, which records who
--                        actually handed it over (written at collection).
--   pickup_at            when they said they'll come
--   pickup_booked_at     when they booked it (last change)
--   pickup_confirmed_at  when the vendor tapped "Got it". Cleared on
--                        re-booking: a new time needs a new yes.

alter table public.orders
  add column pickup_vendor_id    uuid references public.vendors(id),
  add column pickup_at           timestamptz,
  add column pickup_booked_at    timestamptz,
  add column pickup_confirmed_at timestamptz;

-- The vendor counter's "Coming in" list: one vendor, upcoming times.
create index idx_orders_pickup_vendor_at
  on public.orders (pickup_vendor_id, pickup_at)
  where pickup_vendor_id is not null;
