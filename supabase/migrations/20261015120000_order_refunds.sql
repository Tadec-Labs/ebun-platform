-- Refunds from /ops, recorded in SendEbun rather than only in Paystack.
--
-- The refunds table has existed since the first schema; nothing wrote
-- to it. Until now a refund meant clicking around the Paystack dashboard
-- and leaving the order looking paid and live — the recipient could
-- still collect a gift whose money had gone back.

-- One refund in flight or done per order. Two staff clicking at once
-- must not refund twice. A failed attempt doesn't count, so it can be
-- retried.
create unique index refunds_one_active_per_order
  on public.refunds (order_id)
  where status <> 'failed';

-- Paystack's refund webhooks name the original transaction reference.
create index idx_refunds_paystack_reference
  on public.refunds (paystack_reference);

-- ------------------------------------------------------------------
-- begin_order_refund
--
-- Everything that must be true before money goes back, checked and
-- acted on under one lock:
--   * the order is in a state the API says can be refunded
--   * no partner has been credited for handing it over
--   * the gift hasn't been collected — and if its code is still open,
--     the code is voided here, so it can't be collected while the
--     refund is on its way
--   * no other refund is active (the unique index above)
--
-- The redemption row is locked with the order. attempt_redemption()
-- only completes a code whose status is pending/initiated, so once this
-- sets it to 'failed', a counter scanning it a moment later is refused —
-- and if the counter got there first, this sees 'completed' and refuses.
--
-- Returns the redemption status it voided, so the API can put it back
-- if Paystack then refuses the refund (abandon_order_refund).
-- ------------------------------------------------------------------
create or replace function public.begin_order_refund(
  p_order_id            uuid,
  p_refundable_statuses order_status[],
  p_reason              text,
  p_reason_category     text,
  p_initiated_by        uuid
) returns table (
  refund_id                uuid,
  amount                   bigint,
  paystack_reference       text,
  order_status             order_status,
  voided_redemption_status redemption_status
)
language plpgsql
as $$
declare
  v_order      public.orders%rowtype;
  v_redemption public.redemptions%rowtype;
  v_voided     redemption_status := null;
  v_refund_id  uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'refund_order_not_found';
  end if;

  if not (v_order.status = any (p_refundable_statuses)) then
    raise exception 'refund_not_refundable_status';
  end if;

  if v_order.vendor_payout_amount is not null then
    raise exception 'refund_vendor_credited';
  end if;

  select * into v_redemption
    from public.redemptions
   where order_id = p_order_id
     for update;
  if found then
    if v_redemption.status = 'completed' then
      raise exception 'refund_already_collected';
    end if;
    if v_redemption.status in ('pending', 'initiated') then
      v_voided := v_redemption.status;
      update public.redemptions
         set status = 'failed'
       where id = v_redemption.id;
    end if;
  end if;

  insert into public.refunds (
    order_id, amount, reason, reason_category,
    initiated_by_id, initiated_by_type, status, paystack_reference
  ) values (
    p_order_id, v_order.total_amount, p_reason, p_reason_category,
    p_initiated_by, 'admin', 'pending', v_order.paystack_reference
  ) returning id into v_refund_id;

  return query select v_refund_id,
                      v_order.total_amount,
                      v_order.paystack_reference,
                      v_order.status,
                      v_voided;
end;
$$;

-- ------------------------------------------------------------------
-- abandon_order_refund
--
-- Paystack refused (or couldn't be reached). The refund is marked
-- failed — so it can be retried, see the unique index — and the code
-- begin_order_refund voided is given back to the recipient, exactly as
-- it was. Only touches a refund still 'pending': one Paystack accepted
-- is never undone here.
-- ------------------------------------------------------------------
create or replace function public.abandon_order_refund(
  p_refund_id          uuid,
  p_failure_reason     text,
  p_restore_redemption redemption_status
) returns void
language plpgsql
as $$
declare
  v_order_id uuid;
begin
  update public.refunds
     set status = 'failed',
         failed_at = now(),
         failure_reason = left(p_failure_reason, 500)
   where id = p_refund_id
     and status = 'pending'
  returning order_id into v_order_id;

  if v_order_id is not null and p_restore_redemption is not null then
    update public.redemptions
       set status = p_restore_redemption
     where order_id = v_order_id
       and status = 'failed';
  end if;
end;
$$;

-- Only the API (service role) refunds.
revoke execute on function public.begin_order_refund(uuid, order_status[], text, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.abandon_order_refund(uuid, text, redemption_status)
  from public, anon, authenticated;
