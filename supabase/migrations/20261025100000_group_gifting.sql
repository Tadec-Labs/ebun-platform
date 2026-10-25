-- Group gifting: several people chip in for one gift.
--
-- An organiser picks a gift and a deadline and shares one link. Each
-- contributor pays their own share through Paystack. When the pot
-- reaches the gift's price it becomes ONE ordinary order — the same
-- reveal, redemption, delivery, payout and audit path as any gift — and
-- every contributor's line travels with it to the reveal.
--
-- THE KEY DESIGN CHOICES
--
-- 1. The organiser never holds money. Every naira goes into the pot
--    through Paystack and comes out as a gift or a refund.
--
-- 2. Every money step is one locked SQL call, never a read-then-write in
--    the API: confirming a payment, funding the pot and creating its
--    order happen in the same transaction, so a crash can't leave a pot
--    "funded" with no gift, and two webhooks racing can't both count.
--
-- 3. Refunds are rows, not side effects. Closing a pot marks what each
--    contributor is owed (refund_status 'pending', refund_amount); a
--    worker in the API sends them to Paystack and the refund.* webhooks
--    finish them. A failed refund stays visible instead of vanishing
--    inside a request that errored.
--
-- 4. The open RLS policies from the initial schema are removed. They let
--    anyone holding the public anon key read every pot (recipient
--    phones, addresses) and every contribution, and INSERT a contribution
--    with status 'confirmed' — which the old sync trigger would have
--    counted towards the target. All access now goes through the API
--    (service role); the tables are admin-only to direct clients, like
--    campaigns.
--
-- Statuses
--   group_gifts:   open -> funded -> triggered            (gift created)
--                  open -> cancelled | expired            (refunds owed)
--   contributions: pending -> confirmed                   (counted)
--                  pending -> late                        (paid after the pot closed; refunded)
--                  pending -> failed                      (abandoned checkout)
--                  confirmed | late -> refunded           (refund completed)

-- ------------------------------------------------------------------
-- Lock down direct access, and retire the trigger that counted
-- contributions on any insert or update.
-- ------------------------------------------------------------------
drop policy if exists "group_gifts_public_read"      on public.group_gifts;
drop policy if exists "group_gifts_organiser_insert" on public.group_gifts;
drop policy if exists "contributions_public_insert"  on public.group_gift_contributions;
drop policy if exists "contributions_public_read"    on public.group_gift_contributions;

create policy "group_gifts_admin" on public.group_gifts
  for all using (is_ebun_admin());
create policy "group_gift_contributions_admin" on public.group_gift_contributions
  for all using (is_ebun_admin());

drop trigger if exists trg_sync_group_totals on public.group_gift_contributions;
drop function if exists sync_group_gift_totals();

-- ------------------------------------------------------------------
-- group_gifts: what the pot is for, and the organiser's own link.
-- ------------------------------------------------------------------
alter table public.group_gifts
  -- Bearer credential for the organiser's page (/group/manage/<token>).
  -- Separate from `token`, which contributors share freely.
  add column organiser_token   uuid not null unique default gen_random_uuid(),
  -- Price snapshot at creation; target_amount = gift_value + delivery_fee.
  add column gift_value        bigint check (gift_value > 0),
  add column delivery_fee      bigint not null default 0 check (delivery_fee >= 0),
  -- Null = send as soon as it's funded.
  add column send_at           timestamptz,
  -- Contributors see each other's names; amounts only if the organiser says so.
  add column show_amounts      boolean not null default false,
  add column deadline_extended boolean not null default false,
  add column funded_at         timestamptz,
  add column closed_at         timestamptz,
  add column close_reason      text check (char_length(close_reason) <= 200);

alter table public.group_gifts
  add constraint group_gifts_message_length check (char_length(sender_message) <= 1000);

comment on column public.group_gifts.token is
  'Public share token: anyone with the link can see the pot and chip in. Never grants the organiser''s actions.';
comment on column public.group_gifts.organiser_token is
  'Bearer credential for the organiser''s page: extend, switch gift, cancel, and the reveal link once the gift exists.';

-- ------------------------------------------------------------------
-- group_gift_contributions: one Paystack checkout each.
-- ------------------------------------------------------------------
alter table public.group_gift_contributions
  drop constraint if exists group_gift_contributions_status_check;
alter table public.group_gift_contributions
  add constraint group_gift_contributions_status_check
    check (status in ('pending', 'confirmed', 'late', 'failed', 'refunded'));

alter table public.group_gift_contributions
  add column contributor_email      text,
  -- A line for the recipient, shown on the reveal. Never on the public pot page.
  add column message                text check (char_length(message) <= 280),
  -- kobo. amount = towards the gift; service_fee = SendEbun's fee on this share;
  -- total_amount = what Paystack charged (amount + service_fee).
  add column service_fee            bigint not null default 0 check (service_fee >= 0),
  add column total_amount           bigint check (total_amount > 0),
  add column paystack_transaction_id text,
  add column confirmed_at           timestamptz,
  -- Refunds: 'pending' (owed) -> 'submitting' (claimed by the worker)
  -- -> 'processing' (Paystack accepted) -> 'completed'; or 'failed'.
  add column refund_status          text check (refund_status in ('pending', 'submitting', 'processing', 'completed', 'failed')),
  add column refund_amount          bigint check (refund_amount > 0),
  add column refund_attempts        integer not null default 0,
  add column refund_error           text check (char_length(refund_error) <= 300),
  add column paystack_refund_id     text,
  add column refund_requested_at    timestamptz,
  add column refunded_at            timestamptz;

alter table public.group_gift_contributions
  add constraint group_gift_contributions_amount_positive check (amount > 0),
  add constraint group_gift_contributions_name_length check (char_length(contributor_name) between 1 and 120);

create index idx_contributions_refunds_owed
  on public.group_gift_contributions (refund_requested_at)
  where refund_status = 'pending';

-- The order a funded pot became.
alter table public.orders
  add column group_gift_id uuid references public.group_gifts(id);

comment on column public.orders.group_gift_id is
  'Set for gifts paid for by a group pot. Payment lives on the contributions (one Paystack transaction each), so paystack_reference is null on these orders and refunds go back per contribution.';

create unique index idx_orders_group_gift on public.orders (group_gift_id) where group_gift_id is not null;
create index idx_group_gifts_open_deadline on public.group_gifts (deadline) where status = 'open';

-- ------------------------------------------------------------------
-- trigger_group_gift — a funded pot becomes its order.
--
-- Called from confirm_group_contribution and switch_group_gift, inside
-- their transaction, with the pot row already locked. Creates one order
-- and moves it pending_payment -> paid through attempt_order_transition
-- (the same normal edge a sender's payment takes, with its audit row).
-- Idempotent: a pot that is already 'triggered' returns its order.
-- ------------------------------------------------------------------
create or replace function public.trigger_group_gift(p_group_gift_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_pot      public.group_gifts%rowtype;
  v_fees     bigint;
  v_order_id uuid;
  v_moved    public.orders;
  v_send_at  timestamptz;
begin
  select * into v_pot from public.group_gifts where id = p_group_gift_id for update;
  if v_pot.id is null then
    raise exception 'group_gift_not_found';
  end if;
  if v_pot.status = 'triggered' then
    return v_pot.linked_order_id;
  end if;
  if v_pot.status <> 'funded' then
    raise exception 'group_gift_not_funded';
  end if;
  if v_pot.gift_value is null then
    raise exception 'group_gift_has_no_price';
  end if;

  -- Fees on the shares that paid for the gift; a switch's surplus refund
  -- returns gift value only, so every fee here was genuinely earned.
  select coalesce(sum(service_fee), 0) into v_fees
    from public.group_gift_contributions
   where group_gift_id = p_group_gift_id and status = 'confirmed';

  -- A send time already past means "now".
  v_send_at := case when v_pot.send_at > now() then v_pot.send_at else null end;

  insert into public.orders (
    sender_id, gift_template_id, recipient_name, recipient_phone,
    sender_message, message_type, scheduled_send_at, status,
    total_amount, gift_value, delivery_fee, service_fee,
    reveal_theme, group_gift_id, expires_at
  ) values (
    v_pot.organiser_id, v_pot.gift_template_id, v_pot.recipient_name, v_pot.recipient_phone,
    v_pot.sender_message,
    case when v_pot.sender_message is null then null else 'text' end,
    v_send_at, 'pending_payment',
    v_pot.gift_value + v_pot.delivery_fee + v_fees, v_pot.gift_value, v_pot.delivery_fee, v_fees,
    v_pot.reveal_theme, p_group_gift_id,
    coalesce(v_send_at, now()) + interval '30 days'
  ) returning id into v_order_id;

  v_moved := public.attempt_order_transition(
    v_order_id, 'pending_payment', 'paid', 'webhook', null,
    jsonb_build_object('groupGiftId', p_group_gift_id)
  );
  if v_moved.id is null then
    raise exception 'group_gift_order_transition_failed';
  end if;
  update public.orders set payment_verified_at = now() where id = v_order_id;

  update public.group_gifts
     set status = 'triggered', linked_order_id = v_order_id
   where id = p_group_gift_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'group_gift.triggered', null, 'system', 'group_gift', p_group_gift_id,
    'funded', 'triggered',
    jsonb_build_object('orderId', v_order_id, 'raised', v_pot.amount_raised, 'fees', v_fees)
  );

  return v_order_id;
end;
$$;

-- ------------------------------------------------------------------
-- confirm_group_contribution — Paystack confirmed one share.
--
-- Called only by the API, after it has verified the webhook signature.
-- One transaction, contribution and pot both locked:
--   - amount checked against what this checkout charged (loud on mismatch);
--   - pot still open  -> counted; reaching the target funds the pot and
--                        creates its order right here;
--   - pot closed      -> 'late', and a full refund is owed.
-- Returns: 'confirmed' | 'funded' | 'late' | 'already_applied'.
-- ------------------------------------------------------------------
create or replace function public.confirm_group_contribution(
  p_reference      text,
  p_amount         bigint,
  p_transaction_id text
) returns text
language plpgsql
as $$
declare
  v_contribution public.group_gift_contributions%rowtype;
  v_pot          public.group_gifts%rowtype;
  v_raised       bigint;
begin
  select * into v_contribution
    from public.group_gift_contributions
   where paystack_reference = p_reference
   for update;
  if v_contribution.id is null then
    raise exception 'contribution_not_found';
  end if;
  if v_contribution.status <> 'pending' then
    return 'already_applied';
  end if;
  if v_contribution.total_amount is distinct from p_amount then
    raise exception 'contribution_amount_mismatch';
  end if;

  select * into v_pot from public.group_gifts
   where id = v_contribution.group_gift_id
   for update;

  if v_pot.status <> 'open' then
    update public.group_gift_contributions
       set status = 'late',
           confirmed_at = now(),
           paystack_event_id = p_transaction_id,
           paystack_transaction_id = p_transaction_id,
           refund_status = 'pending',
           refund_amount = v_contribution.total_amount,
           refund_requested_at = now()
     where id = v_contribution.id;

    insert into public.audit_events (
      event_type, actor_id, actor_type, resource_type, resource_id,
      previous_state, new_state, metadata
    ) values (
      'group_gift.contribution_late', null, 'webhook', 'group_gift', v_pot.id,
      v_pot.status, v_pot.status,
      jsonb_build_object('contributionId', v_contribution.id, 'amount', p_amount)
    );
    return 'late';
  end if;

  update public.group_gift_contributions
     set status = 'confirmed',
         confirmed_at = now(),
         paystack_event_id = p_transaction_id,
         paystack_transaction_id = p_transaction_id
   where id = v_contribution.id;

  v_raised := v_pot.amount_raised + v_contribution.amount;

  update public.group_gifts
     set amount_raised = v_raised,
         contributor_count = contributor_count + 1,
         status = case when v_raised >= target_amount then 'funded' else status end,
         funded_at = case when v_raised >= target_amount then now() else funded_at end
   where id = v_pot.id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'group_gift.contribution_confirmed', null, 'webhook', 'group_gift', v_pot.id,
    'open', case when v_raised >= v_pot.target_amount then 'funded' else 'open' end,
    jsonb_build_object('contributionId', v_contribution.id, 'amount', v_contribution.amount, 'raised', v_raised)
  );

  if v_raised >= v_pot.target_amount then
    perform public.trigger_group_gift(v_pot.id);
    return 'funded';
  end if;
  return 'confirmed';
end;
$$;

-- ------------------------------------------------------------------
-- close_group_gift — the organiser cancels, or the deadline passes with
-- no decision. Only an open pot closes; every confirmed share is marked
-- for a full refund (gift share and fee: the gift never happened).
-- Shares still mid-checkout are left pending; if they pay later,
-- confirm_group_contribution finds the pot closed and refunds them.
-- Returns the number of refunds owed, or -1 if the pot wasn't open.
-- ------------------------------------------------------------------
create or replace function public.close_group_gift(
  p_group_gift_id uuid,
  p_status        text,
  p_reason        text,
  p_actor_type    text
) returns integer
language plpgsql
as $$
declare
  v_pot   public.group_gifts%rowtype;
  v_owed  integer;
begin
  if p_status not in ('cancelled', 'expired') then
    raise exception 'invalid_close_status';
  end if;

  select * into v_pot from public.group_gifts where id = p_group_gift_id for update;
  if v_pot.id is null then
    raise exception 'group_gift_not_found';
  end if;
  if v_pot.status <> 'open' then
    return -1;
  end if;

  update public.group_gift_contributions
     set refund_status = 'pending',
         refund_amount = total_amount,
         refund_requested_at = now()
   where group_gift_id = p_group_gift_id
     and status = 'confirmed'
     and refund_status is null;
  get diagnostics v_owed = row_count;

  update public.group_gifts
     set status = p_status, closed_at = now(), close_reason = left(p_reason, 200)
   where id = p_group_gift_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'group_gift.' || p_status, null, p_actor_type::actor_type, 'group_gift', p_group_gift_id,
    'open', p_status,
    jsonb_build_object('refundsOwed', v_owed, 'raised', v_pot.amount_raised, 'reason', left(p_reason, 200))
  );

  return v_owed;
end;
$$;

-- ------------------------------------------------------------------
-- switch_group_gift — the target wasn't reached, so the organiser picks
-- a gift the pot already covers.
--
-- The new price comes from the API's PricingService (same as at
-- creation). Whatever the pot holds above it is returned to the
-- contributors pro rata to their gift shares (fees are not refunded:
-- they paid for a gift that is happening). Rounding remainders go to the
-- largest share, so the refunds always sum to the surplus exactly.
-- Then the pot is funded and becomes its order, in this transaction.
-- Returns the new order id.
-- ------------------------------------------------------------------
create or replace function public.switch_group_gift(
  p_group_gift_id    uuid,
  p_gift_template_id uuid,
  p_gift_value       bigint,
  p_delivery_fee     bigint
) returns uuid
language plpgsql
as $$
declare
  v_pot       public.group_gifts%rowtype;
  v_target    bigint;
  v_surplus   bigint;
  v_given     bigint := 0;
  v_share     bigint;
  v_largest   uuid;
  v_row       record;
begin
  if p_gift_value is null or p_gift_value <= 0 or p_delivery_fee < 0 then
    raise exception 'invalid_price';
  end if;

  select * into v_pot from public.group_gifts where id = p_group_gift_id for update;
  if v_pot.id is null then
    raise exception 'group_gift_not_found';
  end if;
  if v_pot.status <> 'open' then
    raise exception 'group_gift_not_open';
  end if;

  v_target := p_gift_value + p_delivery_fee;
  if v_target > v_pot.amount_raised then
    raise exception 'pot_does_not_cover_gift';
  end if;
  v_surplus := v_pot.amount_raised - v_target;

  if v_surplus > 0 then
    select id into v_largest
      from public.group_gift_contributions
     where group_gift_id = p_group_gift_id and status = 'confirmed'
     order by amount desc, confirmed_at, id
     limit 1;

    for v_row in
      select id, amount from public.group_gift_contributions
       where group_gift_id = p_group_gift_id and status = 'confirmed'
    loop
      v_share := floor(v_surplus::numeric * v_row.amount / v_pot.amount_raised);
      v_given := v_given + v_share;
      if v_share > 0 then
        update public.group_gift_contributions
           set refund_status = 'pending', refund_amount = v_share, refund_requested_at = now()
         where id = v_row.id;
      end if;
    end loop;

    if v_surplus - v_given > 0 then
      update public.group_gift_contributions
         set refund_status = 'pending',
             refund_amount = coalesce(refund_amount, 0) + (v_surplus - v_given),
             refund_requested_at = now()
       where id = v_largest;
    end if;
  end if;

  update public.group_gifts
     set gift_template_id = p_gift_template_id,
         gift_value = p_gift_value,
         delivery_fee = p_delivery_fee,
         target_amount = v_target,
         amount_raised = v_target,
         status = 'funded',
         funded_at = now()
   where id = p_group_gift_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'group_gift.switched', null, 'user', 'group_gift', p_group_gift_id,
    'open', 'funded',
    jsonb_build_object(
      'fromTemplate', v_pot.gift_template_id, 'toTemplate', p_gift_template_id,
      'oldTarget', v_pot.target_amount, 'newTarget', v_target, 'surplusRefunded', v_surplus
    )
  );

  return public.trigger_group_gift(p_group_gift_id);
end;
$$;

revoke execute on function public.trigger_group_gift(uuid) from public, anon, authenticated;
revoke execute on function public.confirm_group_contribution(text, bigint, text) from public, anon, authenticated;
revoke execute on function public.close_group_gift(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.switch_group_gift(uuid, uuid, bigint, bigint) from public, anon, authenticated;
