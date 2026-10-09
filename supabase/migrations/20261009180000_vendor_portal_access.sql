-- Vendor portal access.
--
-- A vendor needs to answer one question at their counter: is this code
-- real, and is it for something I sell? Until now only Ebun staff could
-- answer it, which means every single collection is a phone call to
-- ops. That works for a pilot with two vendors and breaks at ten.
--
-- WHY A TOKEN AND NOT A PASSWORD. The device is a shared counter phone,
-- often held by whoever is on shift. A password on that phone gets
-- written on paper or shared between four people, which is strictly
-- worse than a link only that phone has. The realistic threat here is a
-- lost or sold phone, and the answer to that is rotation — which this
-- makes a single UPDATE, versus chasing someone to change a password
-- they shared anyway.
--
-- WHAT THE TOKEN CAN DO, deliberately narrow: look up a code, and
-- confirm a collection for a gift this vendor actually offers. It
-- cannot see other vendors, other orders, bank details, or anything
-- about a code for a gift they do not sell. Confirming still requires
-- the recipient to be standing there with a code, so a leaked token on
-- its own buys nothing.
alter table public.vendors
  add column if not exists portal_token uuid not null default gen_random_uuid(),
  add column if not exists portal_token_rotated_at timestamptz;

-- Unique so a token identifies exactly one vendor, and indexed because
-- every single request from the portal looks a vendor up by it.
create unique index if not exists idx_vendors_portal_token
  on public.vendors(portal_token);

comment on column public.vendors.portal_token is
  'Bearer credential for the vendor counter screen (/vendor/<token>).
   High-entropy and rotatable: UPDATE it to revoke a lost device.
   Scope is deliberately narrow — see the migration that added it.
   Read ONLY by the API via the service role; no RLS policy exposes
   this column to anon or authenticated callers.';

comment on column public.vendors.portal_token_rotated_at is
  'When the token was last rotated, so ops can see at a glance whether a
   revoked device was actually cut off.';

-- The schema already assumed this column exists: redemptions_vendor_read
-- does `select vendor_id from public.users where auth_id = auth.uid()`
-- against a users table that never had the column, so that policy would
-- error if anything ever evaluated it. Adding it makes the existing
-- policy coherent and gives a future vendor login somewhere to point.
-- Nothing reads it yet; the portal uses the token above.
alter table public.users
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

comment on column public.users.vendor_id is
  'Links a user to the vendor they work for. Referenced by the schema''s
   own redemptions_vendor_read policy, which predates this column.
   Unused by the API today — the vendor portal authenticates with
   vendors.portal_token instead.';
