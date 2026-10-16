-- Corporate campaigns: one company sends gifts to many people at once.
--
-- A campaign is a company's send — staff at year end, clients after a
-- good quarter, a brand's best customers. Ops sets it up from a lead;
-- the company then gets a private link (like a vendor's counter link) to
-- upload their list, record one message, pick up to three gifts, set
-- the send date and pay once.
--
-- THE KEY DESIGN CHOICE: each recipient becomes an ordinary order.
-- Reveal, redemption, doorstep delivery, the handover code, vendor
-- payouts, refunds and the audit trail all work on orders already, so a
-- campaign is a thin layer on top of them, not a second system. A
-- campaign order differs only in that (a) the company paid for it as
-- part of one Paystack transaction, held on the campaign, and (b) when
-- the company offered a choice, the recipient picks the gift before it
-- is fulfilled.

create table public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid references public.corporate_leads(id) on delete set null,
  company_name          text not null check (char_length(company_name) between 2 and 120),
  contact_name          text not null check (char_length(contact_name) between 2 and 120),
  contact_email         text not null,
  contact_phone         text,
  title                 text not null default 'A thank-you from us'
                          check (char_length(title) between 2 and 120),
  -- Who the gift is "from" on the reveal, e.g. "Ada Obi, CEO".
  sender_display_name   text check (char_length(sender_display_name) <= 120),
  message_text          text check (char_length(message_text) <= 1000),
  message_type          text not null default 'text'
                          check (message_type in ('text', 'voice', 'video')),
  message_url           text,            -- private R2 key, never a URL
  message_duration_secs integer,
  -- Null = send as soon as it's paid.
  send_at               timestamptz,
  -- How long recipients have to claim, counted from the send.
  gift_days             integer not null default 30 check (gift_days between 7 and 90),
  -- SendEbun's fee on the gifts, in basis points (1000 = 10%). Negotiable per company.
  fee_bps               integer not null default 1000 check (fee_bps between 0 and 3000),
  status                text not null default 'draft'
                          check (status in ('draft', 'awaiting_payment', 'paid', 'cancelled')),
  -- Bearer credential for the company's link (/company/<token>). Rotatable.
  portal_token          uuid not null unique default gen_random_uuid(),
  -- Snapshot taken when checkout starts; the webhook must match it.
  recipients_count      integer,
  seat_price            bigint,          -- kobo, the dearest option incl. delivery
  gift_total            bigint,          -- kobo, seat_price × recipients
  fee_amount            bigint,          -- kobo
  amount_due            bigint,          -- kobo, what Paystack charges
  paystack_reference    text unique,
  paystack_transaction_id text,
  paid_at               timestamptz,
  links_sent_at         timestamptz,
  created_by            uuid references public.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.campaigns is
  'A company sending gifts to many people. draft (company editing) -> awaiting_payment (checkout started; list and gifts frozen) -> paid (one order per recipient created) | cancelled.';

create trigger trg_campaigns_updated_at
  before update on public.campaigns for each row
  execute function handle_updated_at();

-- The gifts a company offers. One = everyone gets it; two or three = each
-- recipient picks. Prices are snapshotted at checkout so a catalogue
-- price change can't move what a paid campaign is owed.
create table public.campaign_gift_options (
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  gift_template_id  uuid not null references public.gift_templates(id),
  position          smallint not null default 0,
  gift_value        bigint,   -- kobo, snapshot at checkout
  delivery_fee      bigint,   -- kobo, snapshot at checkout (doorstep gifts)
  primary key (campaign_id, gift_template_id)
);

create table public.campaign_recipients (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  phone            text not null,            -- E.164
  email            text,
  note             text check (char_length(note) <= 120),  -- team, city, anything HR wants back in the report
  order_id         uuid unique references public.orders(id),
  link_sent_at     timestamptz,
  link_send_error  text,
  thanks_note      text check (char_length(thanks_note) <= 500),
  thanks_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index idx_campaign_recipients_campaign on public.campaign_recipients (campaign_id, created_at);

alter table public.campaigns              enable row level security;
alter table public.campaign_gift_options  enable row level security;
alter table public.campaign_recipients    enable row level security;
create policy "campaigns_admin" on public.campaigns for all using (is_ebun_admin());
create policy "campaign_gift_options_admin" on public.campaign_gift_options for all using (is_ebun_admin());
create policy "campaign_recipients_admin" on public.campaign_recipients for all using (is_ebun_admin());

alter table public.orders
  add column campaign_id    uuid references public.campaigns(id),
  add column gift_chosen_at timestamptz;

comment on column public.orders.campaign_id is
  'Set for gifts sent by a company campaign. Payment lives on the campaign (one Paystack transaction), so paystack_reference is null on these orders.';
comment on column public.orders.gift_chosen_at is
  'Campaign orders only: when the gift was settled — at payment for a single-gift campaign, or when the recipient picked one. Fulfilment starts only after this is set.';

create index idx_orders_campaign on public.orders (campaign_id) where campaign_id is not null;

-- ------------------------------------------------------------------
-- fund_campaign — Paystack confirmed the company's payment.
--
-- Called only by the API, after it has verified the webhook signature.
-- In one transaction: checks the amount against the checkout snapshot,
-- creates one order per recipient and moves each pending_payment ->
-- paid through attempt_order_transition (so every order gets its audit
-- row, exactly as a sender's order does), then marks the campaign paid.
--
-- Why in SQL and not a loop of API calls: a campaign can be hundreds of
-- people, the webhook must answer Paystack quickly, and a crash halfway
-- must not leave half a campaign paid for. All or nothing.
--
-- The only transition made here is pending_payment -> paid, the same
-- normal edge OrderStateMachineService approves for a sender's payment.
--
-- Returns 'funded', or 'already_funded' for a redelivered webhook.
-- ------------------------------------------------------------------
create or replace function public.fund_campaign(
  p_campaign_id     uuid,
  p_reference       text,
  p_amount          bigint,
  p_transaction_id  text
) returns text
language plpgsql
as $$
declare
  v_campaign   public.campaigns%rowtype;
  v_first      public.campaign_gift_options%rowtype;
  v_options    integer;
  v_recipients integer;
  v_expires    timestamptz;
  v_recipient  public.campaign_recipients%rowtype;
  v_order_id   uuid;
  v_moved      public.orders;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id for update;
  if v_campaign.id is null then
    raise exception 'campaign_not_found';
  end if;

  if v_campaign.status = 'paid' and v_campaign.paystack_reference = p_reference then
    return 'already_funded';
  end if;
  if v_campaign.status <> 'awaiting_payment'
     or v_campaign.paystack_reference is distinct from p_reference then
    raise exception 'campaign_not_awaiting_payment';
  end if;
  if v_campaign.amount_due is distinct from p_amount then
    raise exception 'campaign_amount_mismatch';
  end if;

  select count(*) into v_options from public.campaign_gift_options where campaign_id = p_campaign_id;
  select * into v_first from public.campaign_gift_options
   where campaign_id = p_campaign_id order by position, gift_template_id limit 1;
  select count(*) into v_recipients from public.campaign_recipients where campaign_id = p_campaign_id;

  if v_options = 0 or v_first.gift_value is null then
    raise exception 'campaign_has_no_priced_gift';
  end if;
  if v_recipients = 0 or v_recipients <> v_campaign.recipients_count then
    raise exception 'campaign_recipients_changed';
  end if;

  v_expires := greatest(coalesce(v_campaign.send_at, now()), now())
               + make_interval(days => v_campaign.gift_days);

  for v_recipient in
    select * from public.campaign_recipients where campaign_id = p_campaign_id order by created_at, id
  loop
    insert into public.orders (
      sender_id, gift_template_id, recipient_name, recipient_phone,
      sender_message, message_type, message_url, message_duration_secs,
      scheduled_send_at, status, total_amount, gift_value, delivery_fee, service_fee,
      is_corporate_order, corporate_lead_id, campaign_id, gift_chosen_at, expires_at
    ) values (
      null, v_first.gift_template_id, v_recipient.name, v_recipient.phone,
      v_campaign.message_text, v_campaign.message_type, v_campaign.message_url,
      v_campaign.message_duration_secs,
      v_campaign.send_at, 'pending_payment', v_campaign.seat_price, v_first.gift_value,
      coalesce(v_first.delivery_fee, 0), 0,
      true, v_campaign.lead_id, p_campaign_id,
      case when v_options = 1 then now() else null end,
      v_expires
    ) returning id into v_order_id;

    v_moved := public.attempt_order_transition(
      v_order_id, 'pending_payment', 'paid', 'webhook', null,
      jsonb_build_object('campaignId', p_campaign_id, 'paystackReference', p_reference)
    );
    if v_moved.id is null then
      raise exception 'campaign_order_transition_failed';
    end if;

    update public.orders set payment_verified_at = now() where id = v_order_id;
    update public.campaign_recipients set order_id = v_order_id where id = v_recipient.id;
  end loop;

  update public.campaigns
     set status = 'paid',
         paid_at = now(),
         paystack_transaction_id = p_transaction_id
   where id = p_campaign_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'campaign.paid', null, 'webhook', 'campaign', p_campaign_id,
    'awaiting_payment', 'paid',
    jsonb_build_object('reference', p_reference, 'amount', p_amount, 'recipients', v_recipients)
  );

  return 'funded';
end;
$$;

-- ------------------------------------------------------------------
-- choose_campaign_gift — the recipient picks from the company's options.
--
-- One conditional UPDATE: only a paid campaign order whose gift hasn't
-- been settled, and only one of that campaign's own options. The gift's
-- value and delivery fee come from the snapshot the company paid
-- against, never from today's catalogue. Returns the order id, or null
-- when the guard stopped it (already chosen, or not an option).
-- ------------------------------------------------------------------
create or replace function public.choose_campaign_gift(
  p_order_id         uuid,
  p_gift_template_id uuid
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  update public.orders o
     set gift_template_id = opt.gift_template_id,
         gift_value       = opt.gift_value,
         delivery_fee     = coalesce(opt.delivery_fee, 0),
         gift_chosen_at   = now(),
         updated_at       = now()
    from public.campaign_gift_options opt
   where o.id = p_order_id
     and o.status = 'paid'
     and o.campaign_id is not null
     and o.gift_chosen_at is null
     and opt.campaign_id = o.campaign_id
     and opt.gift_template_id = p_gift_template_id
  returning o.id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fund_campaign(uuid, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.choose_campaign_gift(uuid, uuid) from public, anon, authenticated;
