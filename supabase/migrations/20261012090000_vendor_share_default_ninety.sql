-- Revenue model, locked 12 Oct 2026.
--
-- Gifts are sold at the vendor's own in-store price, with no markup.
-- SendEbun earns a commission from the vendor plus a visible service fee
-- from the sender (apps/api/src/pricing/service-fee.ts).
--
-- vendors.commission_rate is the VENDOR's share. The schema defaulted it
-- to 0.70 — the retired 30% take. The new default is 0.90: a 10%
-- commission, negotiable per vendor (8–12%) by setting the column.
--
-- Default only. Existing vendor rows keep whatever rate was agreed with
-- them; offerings keep their stored vendor_price. Re-pricing a signed
-- vendor is a conversation, not a migration.

alter table public.vendors
  alter column commission_rate set default 0.90;

comment on column public.vendors.commission_rate is
  'Vendor''s share of the gift price (0.90 = vendor keeps 90%, SendEbun''s commission is 10%). Used to suggest vendor_price on new offerings; vendor_price on each offering is what is actually paid.';
