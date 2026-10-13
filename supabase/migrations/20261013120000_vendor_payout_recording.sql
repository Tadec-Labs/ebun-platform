-- Vendor payouts: record that a vendor has been paid, for exactly which
-- collections, in one step.
--
-- Every collected gift already carries vendor_id + vendor_payout_amount
-- (written at collection). What was missing is the other half: proof of
-- what SendEbun paid, when, and for which collections — the thing a
-- vendor needs to trust a platform that holds their money for a few days.
--
-- One payout row per transfer. Each order it covers points back at it,
-- so "what did this transfer pay for?" and "has this collection been
-- paid?" are both a single lookup.

alter table public.orders
  add column vendor_payout_id uuid references public.vendor_payouts(id);

create index idx_orders_vendor_unpaid
  on public.orders (vendor_id)
  where vendor_payout_amount is not null and vendor_paid_at is null;

alter table public.vendor_payouts
  add column recorded_by uuid references public.users(id);

comment on column public.orders.vendor_payout_id is
  'The vendor_payouts row (the transfer) that paid the vendor for this collection. Null until paid.';

-- ------------------------------------------------------------------
-- record_vendor_payout
--
-- Atomic on purpose. Ops sends the exact collections they saw on screen;
-- the function locks them, checks every one belongs to this vendor and is
-- still unpaid, and only then writes the payout and marks them paid.
-- Partial success is impossible: either every listed collection is
-- marked paid under one payout whose amount is their exact sum, or
-- nothing changes. Two staff recording the same payout at once: the
-- second fails cleanly instead of paying twice.
--
-- The amount is computed here, never accepted from the caller.
-- Bank details are snapshotted onto the payout row (admin-only by RLS)
-- so a later change of account doesn't rewrite where an old transfer went.
-- ------------------------------------------------------------------
create or replace function public.record_vendor_payout(
  p_vendor_id      uuid,
  p_order_ids      uuid[],
  p_payment_ref    text,
  p_payment_method text,
  p_notes          text,
  p_recorded_by    uuid
) returns public.vendor_payouts
language plpgsql
as $$
declare
  v_vendor   public.vendors%rowtype;
  v_count    integer;
  v_net      bigint;
  v_gross    bigint;
  v_first    date;
  v_last     date;
  v_payout   public.vendor_payouts%rowtype;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'payout_no_orders';
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'payout_vendor_not_found';
  end if;

  -- Lock the rows first, then validate what was locked.
  perform 1 from public.orders where id = any(p_order_ids) for update;

  select count(*), sum(o.vendor_payout_amount), sum(o.gift_value),
         min(coalesce(r.completed_at, o.updated_at))::date,
         max(coalesce(r.completed_at, o.updated_at))::date
    into v_count, v_net, v_gross, v_first, v_last
    from public.orders o
    left join public.redemptions r on r.order_id = o.id
   where o.id = any(p_order_ids)
     and o.vendor_id = p_vendor_id
     and o.vendor_payout_amount is not null
     and o.vendor_paid_at is null;

  if v_count <> (select count(distinct x) from unnest(p_order_ids) as x) then
    raise exception 'payout_orders_invalid';
  end if;

  insert into public.vendor_payouts (
    vendor_id, period_start, period_end, orders_count, gross_amount,
    commission_rate, net_payout, paid, paid_at, payment_method,
    payment_ref, bank_name, account_number, account_name, notes, recorded_by
  ) values (
    p_vendor_id, v_first, v_last, v_count, v_gross,
    v_vendor.commission_rate, v_net, true, now(), coalesce(p_payment_method, 'bank_transfer'),
    p_payment_ref, v_vendor.bank_name, v_vendor.account_number, v_vendor.account_name,
    p_notes, p_recorded_by
  ) returning * into v_payout;

  update public.orders
     set vendor_paid_at = v_payout.paid_at,
         vendor_payout_id = v_payout.id
   where id = any(p_order_ids);

  return v_payout;
end;
$$;

-- Only the API (service role) records payouts.
revoke execute on function public.record_vendor_payout(uuid, uuid[], text, text, text, uuid)
  from public, anon, authenticated;
