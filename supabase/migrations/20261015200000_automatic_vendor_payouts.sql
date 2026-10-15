-- Automatic vendor payouts, minutes after handover.
--
-- Until now SendEbun paid partners by hand: ops read the Payouts queue,
-- made a bank transfer, and recorded it. Partners "don't joke with their
-- money", and a same-day promise kept by hand is one busy afternoon from
-- being broken. Now, when a gift is handed over (code scanned, or a
-- doorstep delivery proven), the API sends the partner's share from the
-- SendEbun Paystack balance to their bank through Paystack Transfers.
--
-- Money still never leaves before the handover: only orders already
-- credited to the partner (vendor_payout_amount set, i.e. collected or
-- delivered) are ever paid.
--
-- One transfer can cover several handovers (a busy evening is one
-- transfer, one fee). A transfer CLAIMS its orders first, under a lock,
-- so the same handover can never be in two transfers, or be paid by hand
-- while a transfer for it is on its way.

-- The partner's bank, as Paystack knows it.
alter table public.vendors
  add column bank_code text,
  add column paystack_recipient_code text;

comment on column public.vendors.bank_code is
  'Paystack/NIBSS bank code for bank_name (e.g. 058 = GTBank). Needed for automatic payouts.';
comment on column public.vendors.paystack_recipient_code is
  'Paystack transfer recipient (RCP_...) for this vendor''s bank account. Cleared whenever the bank details change.';

create table public.vendor_transfers (
  id                     uuid primary key default gen_random_uuid(),
  vendor_id              uuid not null references public.vendors(id),
  order_ids              uuid[] not null,
  amount                 bigint not null check (amount > 0),   -- kobo
  -- Ours, sent to Paystack. Unique, so a retried request can't pay twice.
  reference              text not null unique,
  status                 text not null default 'claimed'
    check (status in ('claimed', 'processing', 'success', 'failed', 'reversed')),
  paystack_transfer_code text,
  failure_reason         text,
  payout_id              uuid references public.vendor_payouts(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.vendor_transfers is
  'Automatic payouts through Paystack Transfers. claimed -> processing (Paystack has it) -> success (recorded as a vendor_payouts row) | failed | reversed (orders released for the next attempt).';

create index idx_vendor_transfers_vendor on public.vendor_transfers (vendor_id, created_at desc);
create index idx_vendor_transfers_open on public.vendor_transfers (status)
  where status in ('claimed', 'processing');

alter table public.vendor_transfers enable row level security;
create policy "vendor_transfers_admin" on public.vendor_transfers
  for all using (is_ebun_admin());

alter table public.orders
  add column vendor_transfer_id uuid references public.vendor_transfers(id);

comment on column public.orders.vendor_transfer_id is
  'The automatic transfer currently paying for this handover. Set while the transfer is in flight; cleared if it fails, so the next attempt picks the order up again.';

-- ------------------------------------------------------------------
-- record_vendor_payout, now aware of in-flight transfers.
--
-- Same function as 20261013120000_vendor_payout_recording.sql, with one
-- extra optional argument. A handover that an automatic transfer has
-- claimed can't be recorded as paid by hand (that would pay it twice);
-- the transfer itself passes its own id to record its orders.
-- ------------------------------------------------------------------
drop function public.record_vendor_payout(uuid, uuid[], text, text, text, uuid);

create or replace function public.record_vendor_payout(
  p_vendor_id      uuid,
  p_order_ids      uuid[],
  p_payment_ref    text,
  p_payment_method text,
  p_notes          text,
  p_recorded_by    uuid,
  p_transfer_id    uuid default null
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
     and o.vendor_paid_at is null
     and o.vendor_transfer_id is not distinct from p_transfer_id;

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

revoke execute on function public.record_vendor_payout(uuid, uuid[], text, text, text, uuid, uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------------------
-- claim_vendor_transfer
--
-- Takes every handover this vendor is owed for and nobody is paying yet,
-- under a lock, and records one transfer for their exact sum. Returns
-- nothing when there's nothing to pay — two callers racing for the same
-- vendor: one gets the orders, the other gets nothing.
-- ------------------------------------------------------------------
create or replace function public.claim_vendor_transfer(
  p_vendor_id uuid,
  p_reference text
) returns setof public.vendor_transfers
language plpgsql
as $$
declare
  v_ids      uuid[];
  v_amount   bigint;
  v_transfer public.vendor_transfers%rowtype;
begin
  -- Serialise claims per vendor.
  perform 1 from public.vendors where id = p_vendor_id for update;

  select array_agg(id), sum(vendor_payout_amount)
    into v_ids, v_amount
    from (
      select id, vendor_payout_amount
        from public.orders
       where vendor_id = p_vendor_id
         and vendor_payout_amount is not null
         and vendor_paid_at is null
         and vendor_transfer_id is null
       order by updated_at
       limit 200
       for update
    ) owed;

  if v_ids is null or coalesce(v_amount, 0) <= 0 then
    return;
  end if;

  insert into public.vendor_transfers (vendor_id, order_ids, amount, reference)
  values (p_vendor_id, v_ids, v_amount, p_reference)
  returning * into v_transfer;

  update public.orders
     set vendor_transfer_id = v_transfer.id
   where id = any(v_ids);

  return next v_transfer;
end;
$$;

-- ------------------------------------------------------------------
-- complete_vendor_transfer — Paystack says the money arrived.
-- Records it as a payout (the same record a manual payment makes) and
-- links the two. Idempotent: a redelivered webhook finds it done.
-- ------------------------------------------------------------------
create or replace function public.complete_vendor_transfer(
  p_transfer_id   uuid,
  p_transfer_code text
) returns public.vendor_transfers
language plpgsql
as $$
declare
  v_transfer public.vendor_transfers%rowtype;
  v_payout   public.vendor_payouts%rowtype;
begin
  select * into v_transfer from public.vendor_transfers
   where id = p_transfer_id for update;
  if not found then
    raise exception 'transfer_not_found';
  end if;
  if v_transfer.status = 'success' then
    return v_transfer;
  end if;
  if v_transfer.status not in ('claimed', 'processing') then
    raise exception 'transfer_not_open';
  end if;

  v_payout := public.record_vendor_payout(
    v_transfer.vendor_id,
    v_transfer.order_ids,
    v_transfer.reference,
    'paystack_transfer',
    'Paid automatically after handover',
    null,
    v_transfer.id
  );

  update public.vendor_transfers
     set status = 'success',
         paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
         payout_id = v_payout.id,
         failure_reason = null,
         updated_at = now()
   where id = p_transfer_id
  returning * into v_transfer;

  return v_transfer;
end;
$$;

-- ------------------------------------------------------------------
-- release_vendor_transfer — it failed or was reversed. The orders go
-- back to "owed, nobody paying", so the next attempt (or ops by hand)
-- picks them up. A transfer already recorded as paid is never released.
-- ------------------------------------------------------------------
create or replace function public.release_vendor_transfer(
  p_transfer_id uuid,
  p_status      text,
  p_reason      text
) returns public.vendor_transfers
language plpgsql
as $$
declare
  v_transfer public.vendor_transfers%rowtype;
begin
  if p_status not in ('failed', 'reversed') then
    raise exception 'transfer_bad_status';
  end if;

  select * into v_transfer from public.vendor_transfers
   where id = p_transfer_id for update;
  if not found then
    raise exception 'transfer_not_found';
  end if;
  if v_transfer.status not in ('claimed', 'processing') then
    return v_transfer;
  end if;

  update public.orders
     set vendor_transfer_id = null
   where vendor_transfer_id = p_transfer_id
     and vendor_paid_at is null;

  update public.vendor_transfers
     set status = p_status,
         failure_reason = left(p_reason, 500),
         updated_at = now()
   where id = p_transfer_id
  returning * into v_transfer;

  return v_transfer;
end;
$$;

-- Only the API (service role) moves money.
revoke execute on function public.claim_vendor_transfer(uuid, text) from public, anon, authenticated;
revoke execute on function public.complete_vendor_transfer(uuid, text) from public, anon, authenticated;
revoke execute on function public.release_vendor_transfer(uuid, text, text) from public, anon, authenticated;
