-- Events: weddings, birthdays, naming ceremonies, send-forths and
-- remembrances. One link for everything guests want to give.
--
-- Two ways to give, both optional per event:
--
--   1. The gift list. Each item is an ordinary group-gift pot with
--      event_id set: guests give it whole or chip in, the same Paystack
--      flow, the same locked SQL, the same refunds. When an item is
--      paid for it becomes one order to the host, delivered or collected
--      after the event like any gift. Nothing new touches that money.
--
--   2. Cash gifts ("spray"). Each guest's gift is one Paystack checkout
--      (reference ebevt_...). The money is paid out to the host's bank
--      account by SendEbun after the event, once ops has checked the
--      account belongs to the host. Until then it sits in SendEbun's
--      Paystack balance, which is why it is switched off by default
--      (EVENTS_CASH) until Paystack approves it.
--
-- Safeguards against a fake event collecting money:
--   - payout only after the event has closed (a few days after the date);
--   - payout only to an account ops has verified for that host;
--   - an unverified host's cash total is capped (EVENT_CASH_CAP_KOBO):
--     a payment that would cross the cap is refunded in full, never kept.
--
-- Same rules as group gifting: every money step is one locked SQL call;
-- refunds are rows a worker sends; direct table access is admin-only and
-- everything else goes through the API with the service role.
--
-- Statuses
--   events:           active -> closed -> (payout recorded)
--                     active -> cancelled                 (cash refunded, open items closed)
--   event_cash_gifts: pending -> confirmed                (counted)
--                     pending -> late                     (event closed or over the cap; refunded)
--                     pending -> failed                   (checkout never started)
--                     confirmed | late -> refunded        (refund completed)

create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  -- Public, shareable: /e/<slug>. Readable words plus a random suffix,
  -- so the link reads well and can't be guessed from the names alone.
  slug                  text not null unique
                          check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 6 and 80),
  -- Bearer credential for the host's page. Never shown to guests.
  host_token            uuid not null unique default gen_random_uuid(),
  host_id               uuid not null references public.users(id),
  host_name             text not null check (char_length(host_name) between 1 and 120),
  -- Gift-list orders are sent to this number (the host receives them).
  host_phone            text not null check (host_phone ~ '^\+[1-9][0-9]{6,14}$'),
  event_type            text not null
                          check (event_type in ('wedding', 'engagement', 'birthday', 'baby', 'send_forth', 'remembrance')),
  title                 text not null check (char_length(title) between 1 and 120),
  event_date            date not null,
  city                  text not null check (char_length(city) between 1 and 80),
  gift_list_enabled     boolean not null default true,
  cash_enabled          boolean not null default false,
  wall_enabled          boolean not null default true,
  -- Whether the wall and guest page may show amounts at all. Each guest
  -- still chooses for their own gift. Never for a remembrance.
  show_amounts          boolean not null default false,
  status                text not null default 'active'
                          check (status in ('active', 'closed', 'cancelled')),
  cash_raised           bigint not null default 0 check (cash_raised >= 0),
  cash_count            integer not null default 0 check (cash_count >= 0),
  -- Ops has checked the host is who they say and the account is theirs.
  verified_at           timestamptz,
  verified_by           uuid references public.users(id),
  payout_bank_code      text check (payout_bank_code ~ '^[0-9A-Za-z]{3,10}$'),
  payout_account_number text check (payout_account_number ~ '^[0-9]{10}$'),
  payout_account_name   text check (char_length(payout_account_name) between 1 and 120),
  payout_status         text not null default 'none' check (payout_status in ('none', 'paid')),
  payout_amount         bigint check (payout_amount >= 0),
  payout_reference      text check (char_length(payout_reference) between 1 and 120),
  paid_out_at           timestamptz,
  paid_out_by           uuid references public.users(id),
  closed_at             timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint events_no_amounts_at_remembrance
    check (event_type <> 'remembrance' or show_amounts = false)
);

comment on table public.events is
  'An event page: gift list (group-gift pots with event_id) and/or cash gifts (event_cash_gifts). Admin-only to direct clients; the API owns all access.';
comment on column public.events.host_token is
  'Bearer credential for /e/manage/<token>: settings, gift list, thank-yous, payout account, cancel. Never grants anything to a guest link.';
comment on column public.events.payout_account_number is
  'Where cash gifts are paid after the event. Never returned in full by the API; never written to audit metadata.';

create trigger set_events_updated_at
  before update on public.events
  for each row execute function handle_updated_at();

create index idx_events_active_date on public.events (event_date) where status = 'active';

-- Gift-list items are pots that belong to an event.
alter table public.group_gifts
  add column event_id uuid references public.events(id);
create index idx_group_gifts_event on public.group_gifts (event_id) where event_id is not null;

-- Hosts tick off who they've thanked, for gift-list shares too.
alter table public.group_gift_contributions
  add column thanked_at timestamptz;

create table public.event_cash_gifts (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references public.events(id),
  guest_name              text not null check (char_length(guest_name) between 1 and 120),
  guest_email             text not null check (char_length(guest_email) between 3 and 254),
  guest_phone             text check (guest_phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- Shown on the wall with the name, if the guest allows it.
  message                 text check (char_length(message) <= 280),
  show_on_wall            boolean not null default true,
  show_amount             boolean not null default false,
  -- kobo. amount = to the host; service_fee = SendEbun's fee;
  -- total_amount = what Paystack charged.
  amount                  bigint not null check (amount > 0),
  service_fee             bigint not null default 0 check (service_fee >= 0),
  total_amount            bigint not null check (total_amount > 0),
  paystack_reference      text not null unique check (paystack_reference like 'ebevt\_%'),
  paystack_transaction_id text,
  status                  text not null default 'pending'
                            check (status in ('pending', 'confirmed', 'late', 'failed', 'refunded')),
  confirmed_at            timestamptz,
  refund_status           text check (refund_status in ('pending', 'submitting', 'processing', 'completed', 'failed')),
  refund_amount           bigint check (refund_amount > 0),
  refund_attempts         integer not null default 0,
  refund_error            text check (char_length(refund_error) <= 300),
  paystack_refund_id      text,
  refund_requested_at     timestamptz,
  refunded_at             timestamptz,
  thanked_at              timestamptz,
  created_at              timestamptz not null default now()
);

create index idx_event_cash_gifts_event on public.event_cash_gifts (event_id, confirmed_at desc)
  where status = 'confirmed';
create index idx_event_cash_gifts_refunds_owed on public.event_cash_gifts (refund_requested_at)
  where refund_status = 'pending';

alter table public.events enable row level security;
alter table public.event_cash_gifts enable row level security;
create policy "events_admin" on public.events for all using (is_ebun_admin());
create policy "event_cash_gifts_admin" on public.event_cash_gifts for all using (is_ebun_admin());

-- ------------------------------------------------------------------
-- confirm_event_cash_gift — Paystack confirmed one guest's cash gift.
--
-- Called only by the API after verifying the webhook signature. Gift
-- row and event row locked in one transaction:
--   - amount checked against this checkout (loud on mismatch);
--   - event no longer taking cash         -> 'late', full refund owed;
--   - unverified host and over p_cap       -> 'over_cap', full refund owed;
--   - otherwise counted                    -> 'confirmed'.
-- p_cap is kobo; 0 means no cap.
-- Returns 'confirmed' | 'late' | 'over_cap' | 'already_applied'.
-- ------------------------------------------------------------------
create or replace function public.confirm_event_cash_gift(
  p_reference      text,
  p_amount         bigint,
  p_transaction_id text,
  p_cap            bigint
) returns text
language plpgsql
as $$
declare
  v_gift   public.event_cash_gifts%rowtype;
  v_event  public.events%rowtype;
  v_reason text;
begin
  select * into v_gift from public.event_cash_gifts
   where paystack_reference = p_reference
   for update;
  if v_gift.id is null then
    raise exception 'event_gift_not_found';
  end if;
  if v_gift.status <> 'pending' then
    return 'already_applied';
  end if;
  if v_gift.total_amount is distinct from p_amount then
    raise exception 'event_gift_amount_mismatch';
  end if;

  select * into v_event from public.events where id = v_gift.event_id for update;

  if v_event.status <> 'active' or not v_event.cash_enabled then
    v_reason := 'late';
  elsif v_event.verified_at is null and p_cap > 0
        and v_event.cash_raised + v_gift.amount > p_cap then
    v_reason := 'over_cap';
  end if;

  if v_reason is not null then
    update public.event_cash_gifts
       set status = 'late',
           confirmed_at = now(),
           paystack_transaction_id = p_transaction_id,
           refund_status = 'pending',
           refund_amount = v_gift.total_amount,
           refund_requested_at = now()
     where id = v_gift.id;

    insert into public.audit_events (
      event_type, actor_id, actor_type, resource_type, resource_id,
      previous_state, new_state, metadata
    ) values (
      'event.cash_gift_refunded_' || v_reason, null, 'webhook', 'event', v_event.id,
      v_event.status, v_event.status,
      jsonb_build_object('giftId', v_gift.id, 'amount', p_amount, 'cashRaised', v_event.cash_raised)
    );
    return v_reason;
  end if;

  update public.event_cash_gifts
     set status = 'confirmed',
         confirmed_at = now(),
         paystack_transaction_id = p_transaction_id
   where id = v_gift.id;

  update public.events
     set cash_raised = cash_raised + v_gift.amount,
         cash_count = cash_count + 1
   where id = v_event.id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'event.cash_gift_confirmed', null, 'webhook', 'event', v_event.id,
    v_event.status, v_event.status,
    jsonb_build_object('giftId', v_gift.id, 'amount', v_gift.amount, 'cashRaised', v_event.cash_raised + v_gift.amount)
  );
  return 'confirmed';
end;
$$;

-- ------------------------------------------------------------------
-- close_event — giving has ended (a few days after the date). Cash
-- that lands afterwards is refunded by confirm_event_cash_gift. Open
-- gift-list pots are left alone: they run to their own deadline and
-- decision window like any pot.
-- Returns true if this call closed it.
-- ------------------------------------------------------------------
create or replace function public.close_event(p_event_id uuid, p_actor_type text)
returns boolean
language plpgsql
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if v_event.status <> 'active' then
    return false;
  end if;

  update public.events set status = 'closed', closed_at = now() where id = p_event_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'event.closed', null, p_actor_type::actor_type, 'event', p_event_id,
    'active', 'closed',
    jsonb_build_object('cashRaised', v_event.cash_raised, 'cashCount', v_event.cash_count)
  );
  return true;
end;
$$;

-- ------------------------------------------------------------------
-- cancel_event — the host calls it off before any payout. Every
-- confirmed cash gift is owed back in full; every gift-list pot still
-- collecting is closed through close_group_gift (its contributors are
-- refunded there). Items already paid for stay: those gifts exist.
-- Returns the number of cash refunds owed, or -1 if it couldn't be
-- cancelled (already cancelled, or paid out).
-- ------------------------------------------------------------------
create or replace function public.cancel_event(
  p_event_id   uuid,
  p_reason     text,
  p_actor_type text
) returns integer
language plpgsql
as $$
declare
  v_event public.events%rowtype;
  v_owed  integer;
  v_pot   record;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if v_event.status = 'cancelled' or v_event.payout_status <> 'none' then
    return -1;
  end if;

  update public.event_cash_gifts
     set refund_status = 'pending',
         refund_amount = total_amount,
         refund_requested_at = now()
   where event_id = p_event_id
     and status = 'confirmed'
     and refund_status is null;
  get diagnostics v_owed = row_count;

  for v_pot in
    select id from public.group_gifts where event_id = p_event_id and status = 'open'
  loop
    perform public.close_group_gift(v_pot.id, 'cancelled', left('The event was cancelled. ' || coalesce(p_reason, ''), 200), p_actor_type);
  end loop;

  update public.events
     set status = 'cancelled', cancelled_at = now()
   where id = p_event_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'event.cancelled', null, p_actor_type::actor_type, 'event', p_event_id,
    v_event.status, 'cancelled',
    jsonb_build_object('cashRefundsOwed', v_owed, 'cashRaised', v_event.cash_raised, 'reason', left(p_reason, 200))
  );
  return v_owed;
end;
$$;

-- ------------------------------------------------------------------
-- record_event_payout — ops has paid the host (bank transfer) and
-- records it. Only a closed, verified event with an account on file,
-- once, and never for more than was raised.
-- Returns true if recorded.
-- ------------------------------------------------------------------
create or replace function public.record_event_payout(
  p_event_id  uuid,
  p_amount    bigint,
  p_reference text,
  p_staff_id  uuid
) returns boolean
language plpgsql
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if v_event.status <> 'closed' then
    raise exception 'event_not_closed';
  end if;
  if v_event.verified_at is null or v_event.payout_account_number is null then
    raise exception 'event_not_verified';
  end if;
  if v_event.payout_status <> 'none' then
    return false;
  end if;
  if p_amount < 0 or p_amount > v_event.cash_raised then
    raise exception 'invalid_payout_amount';
  end if;

  update public.events
     set payout_status = 'paid',
         payout_amount = p_amount,
         payout_reference = p_reference,
         paid_out_at = now(),
         paid_out_by = p_staff_id
   where id = p_event_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'event.paid_out', p_staff_id, 'admin', 'event', p_event_id,
    'none', 'paid',
    jsonb_build_object('amount', p_amount, 'cashRaised', v_event.cash_raised, 'reference', p_reference)
  );
  return true;
end;
$$;

revoke execute on function public.confirm_event_cash_gift(text, bigint, text, bigint) from public, anon, authenticated;
revoke execute on function public.close_event(uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_event(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.record_event_payout(uuid, bigint, text, uuid) from public, anon, authenticated;
