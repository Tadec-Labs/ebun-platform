-- Vendors ask for a new price from their counter link.
--
-- A vendor's in-store price is what SendEbun charges senders for their
-- gift (gift_templates.base_price), so a vendor can't just change it:
-- the change is held on their offering as a request, the old price keeps
-- selling, and ops approves or declines it.
--
-- proposed_price is an IN-STORE price (kobo), the same number the vendor
-- typed when they first listed the item. On approval it becomes the
-- gift's base_price and the vendor's share is recomputed from it.

alter table public.vendor_gift_offerings
  add column proposed_price    bigint check (proposed_price is null or proposed_price > 0),
  add column price_proposed_at timestamptz,
  add constraint vendor_gift_offerings_proposal_complete
    check ((proposed_price is null) = (price_proposed_at is null));

comment on column public.vendor_gift_offerings.proposed_price is
  'In-store price (kobo) the vendor has asked to change to. Null = no request. Senders keep paying base_price until ops approves.';
comment on column public.vendor_gift_offerings.price_proposed_at is
  'When the vendor asked. Set and cleared together with proposed_price.';

-- ------------------------------------------------------------------
-- approve_offering_price_change
--
-- Two rows change together — the gift's price and this vendor's share —
-- so they change in one transaction. Half of it (a new share against
-- the old price, or the reverse) would misprice every sale until noticed.
--
-- p_expected_price is the price ops saw on screen. If the vendor sent a
-- different number in the meantime, nothing changes and ops sees the new
-- request instead of approving one they never looked at.
--
-- One gift has one price for every seller, so a gift sold by more than
-- one vendor is refused here as well as in the API. The gift row is
-- locked first: adding an offering takes a key-share lock on its gift,
-- so no seller can be added between the check and the update.
--
-- p_vendor_price is computed by the API (VendorPortalService's
-- vendorShareOf) so the rounding rule lives in one place; it is checked
-- here only for being below the new price.
-- ------------------------------------------------------------------
create or replace function public.approve_offering_price_change(
  p_vendor_id        uuid,
  p_gift_template_id uuid,
  p_expected_price   bigint,
  p_vendor_price     bigint
) returns table (
  old_base_price   bigint,
  new_base_price   bigint,
  old_vendor_price bigint,
  new_vendor_price bigint
)
language plpgsql
as $$
declare
  v_gift     public.gift_templates%rowtype;
  v_offering public.vendor_gift_offerings%rowtype;
begin
  select * into v_gift
    from public.gift_templates
   where id = p_gift_template_id
     for update;
  if not found then
    raise exception 'price_change_not_found';
  end if;

  select * into v_offering
    from public.vendor_gift_offerings
   where vendor_id = p_vendor_id
     and gift_template_id = p_gift_template_id
     for update;
  if not found or v_offering.proposed_price is null then
    raise exception 'price_change_not_found';
  end if;

  if v_offering.proposed_price <> p_expected_price then
    raise exception 'price_change_stale';
  end if;

  if exists (
    select 1 from public.vendor_gift_offerings
     where gift_template_id = p_gift_template_id
       and vendor_id <> p_vendor_id
  ) then
    raise exception 'price_change_shared_gift';
  end if;

  if p_vendor_price < 1 or p_vendor_price >= v_offering.proposed_price then
    raise exception 'price_change_invalid_share';
  end if;

  update public.gift_templates
     set base_price = v_offering.proposed_price,
         updated_at = now()
   where id = p_gift_template_id;

  update public.vendor_gift_offerings
     set vendor_price      = p_vendor_price,
         proposed_price    = null,
         price_proposed_at = null
   where vendor_id = p_vendor_id
     and gift_template_id = p_gift_template_id;

  return query select v_gift.base_price,
                      v_offering.proposed_price,
                      v_offering.vendor_price,
                      p_vendor_price;
end;
$$;

-- Only the API (service role) approves prices.
revoke execute on function public.approve_offering_price_change(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
