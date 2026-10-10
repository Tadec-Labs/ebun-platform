-- Where a recipient actually goes to collect a voucher gift.
--
-- Until now a recipient who claimed a gift was told "show this at the
-- counter" with no way to know which counter: vendors had service_areas
-- (neighbourhoods they cover) but no address, so the reveal screen had
-- nothing honest to show. These two columns are what it shows, for every
-- active vendor that offers the gift — the same set of vendors whose
-- counter screen will accept the code.
--
-- Both nullable and free text on purpose. A vendor without an address
-- is simply not listed as a collection point (it can still be credited
-- by ops); free text because Lagos addresses do not fit a structured
-- form well ("Opposite Mega Plaza, Admiralty Way, Lekki Phase 1"), and
-- the recipient reads this, not a machine. Directions are built from
-- name + address on the screen, so no coordinates are needed.

alter table public.vendors
  add column if not exists pickup_address text,
  add column if not exists pickup_hours   text;

alter table public.vendors
  add constraint vendors_pickup_address_length check (pickup_address is null or char_length(pickup_address) <= 300),
  add constraint vendors_pickup_hours_length   check (pickup_hours   is null or char_length(pickup_hours)   <= 120);

comment on column public.vendors.pickup_address is
  'Shown to gift recipients as where to collect. Null = not listed as a collection point.';
comment on column public.vendors.pickup_hours is
  'Free text shown under the address, e.g. "Mon–Sat, 10am–9pm".';
