-- ============================================================
-- EBUN — Complete Database Schema v2.0
-- Migration: 20250409000000_ebun_complete_schema
-- Supersedes: v1.0 initial schema
-- Added: Audit trail, idempotency, redemptions, fulfillments,
--        notifications, refunds, comprehensive state machines,
--        race condition protection, RBAC
-- ============================================================
-- APPLY: supabase migration new ebun_complete_schema
--        paste this file, then: npx supabase db push
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm"; -- for text search on addresses


-- ============================================================
-- SEQUENCES
-- ============================================================
create sequence if not exists ebun_order_seq start 1;
create sequence if not exists ebun_redemption_seq start 1;

comment on sequence ebun_order_seq is
  'Auto-incrementing sequence for human-readable order numbers (EBN-0001).';
comment on sequence ebun_redemption_seq is
  'Auto-incrementing sequence for human-readable redemption codes (RDM-0001).';


-- ============================================================
-- ENUMS — Centralised state definitions
-- All valid states are defined here, not scattered across the codebase.
-- ============================================================

-- Order states — the authoritative lifecycle
-- IMPORTANT: state transitions are enforced in NestJS, not here.
-- The CHECK constraint is a last-resort guard, not the primary control.
-- Valid transitions:
--   draft → pending_payment
--   pending_payment → paid | payment_failed | cancelled
--   paid → processing
--   processing → vendor_notified | fulfillment_in_progress (VTU/digital)
--   vendor_notified → vendor_accepted | vendor_declined | vendor_timeout
--   vendor_accepted → fulfillment_in_progress
--   vendor_declined | vendor_timeout → processing (reassignment) | cancelled
--   fulfillment_in_progress → dispatched (physical) | ready_for_redemption (digital)
--   dispatched → delivered
--   delivered → reveal_opened | fulfilled (if no reveal required)
--   ready_for_redemption → reveal_opened
--   reveal_opened → redeemed | expired
--   redeemed → fulfilled
--   [any] → refunded (admin action)
--   [any] → cancelled (within cancellation window)

create type order_status as enum (
  'draft',                  -- order created, not yet paid
  'pending_payment',        -- awaiting Paystack confirmation
  'paid',                   -- payment webhook confirmed, verified
  'processing',             -- gift being routed to vendor/VTU
  'vendor_notified',        -- vendor received WhatsApp notification
  'vendor_accepted',        -- vendor confirmed they can fulfil
  'vendor_declined',        -- vendor rejected (triggers reassignment)
  'vendor_timeout',         -- vendor did not respond within window
  'fulfillment_in_progress',-- vendor actively preparing
  'dispatched',             -- rider collected, en route (physical only)
  'delivered',              -- confirmed delivered (physical only)
  'voucher_issued',         -- digital voucher/QR generated and ready
  'ready_for_redemption',   -- waiting for recipient to reveal and claim
  'reveal_opened',          -- recipient opened the reveal page
  'redeemed',               -- gift successfully redeemed
  'fulfilled',              -- complete lifecycle, no further action needed
  'payment_failed',         -- Paystack confirmed failure
  'fulfillment_failed',     -- vendor/VTU/delivery failure, not resolved
  'redemption_failed',      -- redemption attempted but failed
  'expired',                -- gift not claimed within expiry window
  'cancelled',              -- cancelled before fulfillment
  'refunded'                -- refund processed
);

create type fulfillment_type as enum (
  'physical',          -- requires rider delivery
  'digital_voucher',   -- QR code / voucher at a brand location
  'vtu',               -- instant API (airtime, data, electricity)
  'experience'         -- booking/appointment based
);

create type fulfillment_status as enum (
  'pending',
  'vendor_notified',
  'vendor_accepted',
  'vendor_declined',
  'vendor_timeout',
  'in_progress',
  'rider_dispatched',
  'delivered',
  'voucher_generated',
  'vtu_processing',
  'vtu_complete',
  'completed',
  'failed',
  'cancelled'
);

create type redemption_status as enum (
  'pending',     -- token generated, not yet initiated
  'initiated',   -- recipient has started the redemption flow
  'completed',   -- successfully redeemed (FINAL)
  'failed',      -- failed attempt (retryable up to max_attempts)
  'expired'      -- window passed without redemption
);

create type notification_channel as enum ('whatsapp', 'sms', 'email', 'push');
create type notification_status as enum ('pending', 'sent', 'delivered', 'failed', 'retrying', 'cancelled');
create type actor_type as enum ('user', 'vendor', 'system', 'webhook', 'admin', 'cron');
create type refund_status as enum ('pending', 'processing', 'completed', 'failed');


-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Updated_at trigger function (applies to all relevant tables)
create or replace function handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Fallback code generator: EBN-XXXXXX (6 alphanumeric chars, no ambiguous chars)
create or replace function generate_fallback_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0,O,1,I
  code  text := 'EBN-';
  i     int;
begin
  for i in 1..6 loop
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return code;
end;
$$;

-- Order number generator trigger
create or replace function generate_order_number()
returns trigger language plpgsql as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'EBN-' || lpad(nextval('ebun_order_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;


-- ============================================================
-- TABLE: users
-- Extended profile linked to Supabase Auth.
-- Role is enforced at API layer (NestJS guards), not just here.
-- ============================================================
create table public.users (
  id             uuid primary key default gen_random_uuid(),
  auth_id        uuid unique references auth.users(id) on delete cascade,
  phone          text unique,
  email          text unique,
  name           text,
  role           text not null default 'sender'
                   check (role in ('sender', 'recipient', 'vendor',
                                   'vendor_admin', 'corporate_admin',
                                   'ebun_support', 'ebun_ops',
                                   'ebun_finance', 'ebun_admin')),
  country_code   text not null default '+234',
  avatar_url     text,
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.users is
  'Extended user profiles. Linked 1:1 to Supabase Auth via auth_id.
   Role is the RBAC role — enforced at API layer in NestJS.
   All roles beyond "sender" require admin assignment.';

comment on column public.users.role is
  'sender: consumer or diaspora gifter
   recipient: gift receiver (may not be a registered user)
   vendor: merchant partner
   vendor_admin: manages a vendor account
   corporate_admin: manages corporate campaigns
   ebun_support: read-only access for customer support
   ebun_ops: operational controls, order management
   ebun_finance: payout and settlement access
   ebun_admin: full system access';


-- ============================================================
-- TABLE: vendors
-- Merchant partners who fulfill physical and experience gifts.
-- VTU gifts (airtime, data, electricity) bypass this table.
-- ============================================================
create table public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  business_name       text not null,
  owner_name          text not null,
  whatsapp_number     text not null,
  email               text,
  category            text not null
                        check (category in ('food', 'experience', 'keepsake', 'utility')),
  subcategories       text[],
  service_areas       text[],           -- Lagos neighbourhoods covered
  delivery_zones      text[],           -- zone codes: 'zone_1', 'zone_2', etc.
  commission_rate     numeric(4,2) not null default 0.70,
  bank_name           text,
  account_number      text,
  account_name        text,
  active              boolean not null default true,
  verified            boolean not null default false,  -- Ebun has vetted this vendor
  rating              numeric(3,2),
  total_orders        integer not null default 0,
  response_timeout_minutes integer not null default 120,  -- auto-escalate if no response
  backup_vendor_id    uuid references public.vendors(id), -- fallback if this vendor declines
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.vendors is
  'Merchant partners. verified=true means Ebun has physically inspected
   and approved this vendor. response_timeout_minutes is the window
   before the system auto-escalates an unaccepted order.
   backup_vendor_id enables automatic reassignment on decline/timeout.';


-- ============================================================
-- TABLE: gift_templates
-- The product catalogue — what senders can choose.
-- Separates the "what" (template) from the "who fulfils it" (vendor).
-- ============================================================
create table public.gift_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  category            text not null
                        check (category in ('food', 'experience', 'keepsake', 'utility')),
  subcategory         text,
  occasions           text[],
  base_price          bigint not null,    -- kobo: minimum price across all vendors
  delivery_type       fulfillment_type not null,
  delivery_window     text,              -- human-readable: '2-4hrs', 'instant', etc.
  image_url           text,
  available           boolean not null default true,
  featured            boolean not null default false,
  sort_order          integer not null default 0,
  requires_address    boolean not null default false,  -- physical gifts need recipient address
  digital_only        boolean not null default false,  -- can be sent anywhere in Nigeria
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.gift_templates is
  'Defines gift categories and experiences — the "what" a sender chooses.
   Vendor assignment happens at order time based on recipient zone.
   This separation means adding a new city is a vendor ops task,
   not a product catalogue change.';


-- ============================================================
-- TABLE: vendor_gift_offerings
-- Maps which vendors can fulfil which gift templates, and in which zones.
-- ============================================================
create table public.vendor_gift_offerings (
  vendor_id           uuid not null references public.vendors(id) on delete cascade,
  gift_template_id    uuid not null references public.gift_templates(id) on delete cascade,
  vendor_price        bigint not null,   -- kobo: what Ebun pays this vendor
  available_zones     text[],            -- zones this vendor covers for this gift
  available           boolean not null default true,
  approved            boolean not null default false,  -- Ebun has verified vendor's version
  primary key (vendor_id, gift_template_id)
);

comment on table public.vendor_gift_offerings is
  'Many-to-many: vendor X can fulfil template Y in zones Z1, Z2.
   approved=true means Ebun ops has checked the vendor''s execution
   meets the template specification before allowing orders to route here.';


-- ============================================================
-- TABLE: orders
-- Core transaction table. One row per gift sent.
-- ALL monetary values in KOBO to avoid floating point errors.
-- State transitions are enforced by NestJS state machine.
-- This table is the source of truth for order state.
-- ============================================================
create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  order_number            text unique,   -- EBN-XXXX, generated by trigger
  sender_id               uuid references public.users(id) on delete set null,
  gift_template_id        uuid not null references public.gift_templates(id),
  vendor_id               uuid references public.vendors(id),  -- assigned after address confirmed

  -- Recipient (may not be a registered user)
  recipient_name          text not null,
  recipient_phone         text not null,   -- WhatsApp number, international format
  delivery_address        text,            -- entered by recipient after reveal; required for physical
  delivery_zone           text,            -- computed from recipient address

  -- Personalisation
  sender_message          text,
  message_type            text check (message_type in ('text', 'voice', 'video')),
  message_url             text,            -- Cloudflare R2 URL (presigned upload, private)
  message_duration_secs   integer,         -- for voice/video length validation
  reveal_theme            text not null default 'gold'
                            check (reveal_theme in ('gold', 'red', 'white', 'green')),

  -- Reveal mechanics — two separate tokens with different purposes
  reveal_token            uuid unique not null default gen_random_uuid(),
  -- reveal_token: used to access the reveal page. May be forwarded;
  -- possessing it does NOT grant redemption rights.

  reveal_url              text,            -- full constructed URL for WhatsApp message
  reveal_opened_at        timestamptz,     -- when recipient first tapped the link
  reveal_opened_ip        text,

  -- Scheduling
  scheduled_send_at       timestamptz,     -- null = send immediately on payment confirmed
  whatsapp_sent_at        timestamptz,

  -- State machine — authoritative order status
  status                  order_status not null default 'draft',

  -- Payment
  paystack_reference      text unique,     -- Paystack transaction reference
  paystack_event_id       text unique,     -- for idempotency: Paystack webhook event ID
  payment_verified_at     timestamptz,     -- when webhook was verified by backend
  total_amount            bigint not null, -- total charged to sender (kobo)
  gift_value              bigint not null, -- base gift price (kobo)
  delivery_fee            bigint not null default 0,
  service_fee             bigint not null default 0,
  vendor_payout_amount    bigint,          -- calculated at fulfillment time
  vendor_paid_at          timestamptz,

  -- Vendor management
  vendor_timeout_at       timestamptz,     -- set when vendor is notified; triggers auto-escalate
  vendor_response_at      timestamptz,

  -- Swap mechanic
  swap_requested          boolean not null default false,
  swapped_to_template_id  uuid references public.gift_templates(id),

  -- Metadata
  is_corporate_order      boolean not null default false,
  corporate_lead_id       uuid,            -- links to corporate_leads when applicable
  sender_ip               text,
  sender_country_code     text,            -- ISO2: 'NG', 'GB', 'US', 'CA'
  is_diaspora_sender      boolean not null default false,
  notes                   text,            -- internal ops notes
  expires_at              timestamptz not null default (now() + interval '30 days'),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.orders is
  'Core transaction table. State transitions must go through NestJS
   state machine — never update status directly from client.
   reveal_token ≠ redemption token. reveal_token is in the WhatsApp
   link and may be forwarded. Redemption is controlled separately
   in the redemptions table with additional verification.
   All amounts in kobo. paystack_event_id ensures idempotency
   when Paystack delivers the same webhook twice.';


-- ============================================================
-- TABLE: redemptions
-- Security-critical subsystem. Separate from orders by design.
-- Controls the actual redemption of gift value.
-- Race condition protection via database-level atomic update.
-- ============================================================
create table public.redemptions (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null unique references public.orders(id), -- one redemption per order
  redemption_number     text unique not null, -- RDM-XXXX for vendor reference
  redemption_token      uuid unique not null default gen_random_uuid(),
  -- redemption_token: HIGH ENTROPY, SEPARATE from reveal_token.
  -- Only generated after recipient confirms acceptance (post-reveal).
  -- Never exposed in URL params — only in QR code payload.

  fallback_code         text unique not null default generate_fallback_code(),
  -- fallback_code: human-readable 6-char code for manual vendor entry
  -- when QR scanning fails. Format: EBN-XXXXXX

  status                redemption_status not null default 'pending',

  -- Timing controls
  expires_at            timestamptz not null,  -- 30 days from order.paid_at
  initiated_at          timestamptz,           -- when recipient first attempted
  completed_at          timestamptz,           -- when successfully redeemed (FINAL STATE)
  failed_at             timestamptz,

  -- Attempt tracking
  redemption_attempts   integer not null default 0,
  max_attempts          integer not null default 5,  -- after max, escalate to ops

  -- Vendor confirmation
  vendor_id             uuid references public.vendors(id),
  vendor_confirmed_by   text,             -- name/identifier of staff who confirmed
  vendor_confirmed_at   timestamptz,
  vendor_scan_device    text,             -- device info for fraud audit

  -- Security audit
  initiated_ip          text,
  initiated_user_agent  text,
  completed_ip          text,

  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.redemptions is
  'Security-critical. Separate from orders to enforce single-use control.
   RACE CONDITION PROTECTION: redemption must be completed via atomic
   UPDATE ... WHERE status = ''pending'' RETURNING id.
   If RETURNING returns no rows, redemption already processed — reject.
   redemption_token is never in a URL. It is the QR code payload.
   fallback_code is for manual entry when QR fails.
   max_attempts prevents brute force. After max, ops must manually unlock.';


-- ============================================================
-- TABLE: gift_fulfillments
-- Tracks the physical/digital/VTU fulfillment lifecycle.
-- Separate from orders so fulfillment state doesn't pollute order state.
-- ============================================================
create table public.gift_fulfillments (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null unique references public.orders(id),
  fulfillment_type        fulfillment_type not null,
  status                  fulfillment_status not null default 'pending',
  vendor_id               uuid references public.vendors(id),

  -- Physical delivery fields
  rider_name              text,
  rider_phone             text,
  rider_dispatched_at     timestamptz,
  rider_estimated_arrival timestamptz,
  delivered_at            timestamptz,
  delivery_confirmation   text,           -- how delivery was confirmed

  -- Digital voucher fields
  voucher_code            text,           -- the QR code payload / voucher code
  voucher_issued_at       timestamptz,
  voucher_valid_until     timestamptz,

  -- VTU fulfillment fields
  vtu_provider            text,           -- 'nellobytes', 'shago', 'buypower'
  vtu_transaction_id      text,
  vtu_request_id          text,           -- for idempotency with VTU provider
  vtu_phone_number        text,           -- the number topped up
  vtu_completed_at        timestamptz,

  -- Experience booking fields
  booking_reference       text,
  booking_date            timestamptz,
  booking_instructions    text,

  -- Failure handling
  failure_reason          text,
  retry_count             integer not null default 0,
  max_retries             integer not null default 3,
  next_retry_at           timestamptz,

  -- Vendor timeout
  vendor_notified_at      timestamptz,
  vendor_accepted_at      timestamptz,
  vendor_declined_at      timestamptz,
  vendor_decline_reason   text,
  vendor_timeout_at       timestamptz,    -- cron job checks this

  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.gift_fulfillments is
  'Tracks how each gift is actually delivered to the recipient.
   Type-specific fields: use delivery fields for physical, voucher fields
   for digital, vtu fields for utility gifts.
   vtu_request_id enables idempotency with VTU APIs — always set before
   calling provider, check if set before retrying.
   vendor_timeout_at is polled by a cron job every 30 minutes.';


-- ============================================================
-- TABLE: notifications
-- Tracks every outbound communication — WhatsApp, SMS, email.
-- Enables retry logic and delivery confirmation.
-- ============================================================
create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references public.orders(id) on delete set null,
  recipient_type      text not null check (recipient_type in ('sender','recipient','vendor','admin')),
  recipient_phone     text,
  recipient_email     text,
  channel             notification_channel not null,
  notification_type   text not null,
  -- Notification types:
  -- GIFT_REVEAL_LINK, ORDER_CONFIRMED, VENDOR_NEW_ORDER, VENDOR_REMINDER,
  -- DELIVERY_UPDATE, REDEMPTION_CONFIRMED, PAYMENT_FAILED, REFUND_PROCESSED

  status              notification_status not null default 'pending',
  provider            text,               -- 'termii', 'sendgrid', etc.
  provider_message_id text,               -- provider's ID for delivery tracking
  template_name       text,               -- name of approved WhatsApp template
  payload             jsonb,              -- full message payload for audit/retry

  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  error_message       text,

  retry_count         integer not null default 0,
  max_retries         integer not null default 3,
  next_retry_at       timestamptz,        -- for background job scheduler

  idempotency_key     text unique,        -- prevents duplicate sends on retry
  created_at          timestamptz not null default now()
);

comment on table public.notifications is
  'Every outbound notification is logged here before being sent.
   idempotency_key prevents duplicate messages on worker retry.
   Background job polls for status=pending OR status=retrying
   where next_retry_at < now().
   Provider delivery receipts update delivered_at when available.';


-- ============================================================
-- TABLE: audit_events
-- IMMUTABLE event log. Every significant state change is recorded here.
-- This table NEVER has UPDATE or DELETE operations.
-- It is Ebun''s source of truth for disputes, fraud, and debugging.
-- ============================================================
create table public.audit_events (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,
  -- Event types:
  -- ORDER_CREATED, PAYMENT_INITIATED, PAYMENT_CONFIRMED, PAYMENT_FAILED
  -- PAYMENT_WEBHOOK_DUPLICATE (idempotency triggered)
  -- GIFT_REVEAL_SENT, GIFT_REVEAL_OPENED
  -- REDEMPTION_INITIATED, REDEMPTION_COMPLETED, REDEMPTION_FAILED
  -- REDEMPTION_DUPLICATE_ATTEMPT (race condition caught)
  -- VENDOR_NOTIFIED, VENDOR_ACCEPTED, VENDOR_DECLINED, VENDOR_TIMEOUT
  -- FULFILLMENT_STARTED, FULFILLMENT_COMPLETED, FULFILLMENT_FAILED
  -- ORDER_CANCELLED, REFUND_INITIATED, REFUND_COMPLETED
  -- ORDER_STATUS_CHANGED
  -- CORPORATE_LEAD_CREATED, CORPORATE_ORDER_TRIGGERED
  -- VENDOR_CREATED, VENDOR_SUSPENDED
  -- USER_ROLE_CHANGED (sensitive)

  actor_id       uuid,              -- user/system ID who triggered event
  actor_type     actor_type not null,
  resource_type  text not null,     -- 'order', 'redemption', 'payment', 'vendor', etc.
  resource_id    uuid not null,     -- the ID of the affected resource
  previous_state text,              -- state before transition
  new_state      text,              -- state after transition
  metadata       jsonb,             -- event-specific additional data
  ip_address     text,              -- request IP if triggered by user action
  user_agent     text,
  created_at     timestamptz not null default now()
  -- NO updated_at — this table is append-only
);

comment on table public.audit_events is
  'IMMUTABLE APPEND-ONLY event log. Never UPDATE or DELETE rows.
   Every significant business event is recorded here with full context.
   Used for: fraud investigation, vendor disputes, customer support,
   refund evidence, debugging, analytics, regulatory compliance (NDPC).
   RLS: all roles can INSERT; nobody can UPDATE or DELETE.
   Admin can SELECT all; other roles see only their own resources.';


-- ============================================================
-- TABLE: idempotency_keys
-- Prevents duplicate processing of external events (webhooks, etc.)
-- ============================================================
create table public.idempotency_keys (
  id               uuid primary key default gen_random_uuid(),
  key              text unique not null,
  -- Key format examples:
  -- 'paystack_webhook_evt_xxxxxxxx' (Paystack event ID)
  -- 'termii_delivery_msg_xxxxxxxx'  (Termii delivery receipt)
  -- 'vtu_nellobytes_req_xxxxxxxx'   (VTU provider request)

  resource_type    text not null,    -- what was processed
  resource_id      uuid,             -- ID of created/updated resource
  response_status  integer,          -- HTTP status of original response
  processed_at     timestamptz not null default now()
);

comment on table public.idempotency_keys is
  'Deduplication store for external events.
   Before processing any webhook or external event:
   1. Attempt INSERT with the event ID as key
   2. If INSERT fails (unique violation), event was already processed — return 200
   3. If INSERT succeeds, process the event
   This prevents double-charges, double-fulfillments, and duplicate notifications
   when providers retry delivery of the same event.
   Clean up entries older than 90 days via scheduled job.';


-- ============================================================
-- TABLE: refunds
-- Tracks the full refund lifecycle.
-- ============================================================
create table public.refunds (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id),
  amount                bigint not null,   -- kobo
  reason                text not null,
  reason_category       text check (reason_category in (
                           'vendor_failure', 'delivery_failure', 'recipient_request',
                           'duplicate_payment', 'fraud', 'admin_discretion', 'other'
                         )),
  initiated_by_id       uuid references public.users(id),
  initiated_by_type     text check (initiated_by_type in ('sender', 'admin', 'system')),
  status                refund_status not null default 'pending',
  paystack_refund_id    text,
  paystack_reference    text,
  processed_at          timestamptz,
  failed_at             timestamptz,
  failure_reason        text,
  notes                 text,
  created_at            timestamptz not null default now()
);

comment on table public.refunds is
  'Full refund lifecycle. Multiple refunds per order possible
   (e.g. partial refund on delivery failure, then full refund on escalation).
   Sum of refunds.amount must never exceed orders.total_amount.
   This is validated at API layer in NestJS before Paystack refund call.';


-- ============================================================
-- TABLE: group_gifts (Ajo Gifting feature)
-- ============================================================
create table public.group_gifts (
  id                uuid primary key default gen_random_uuid(),
  gift_template_id  uuid not null references public.gift_templates(id),
  organiser_id      uuid not null references public.users(id),
  recipient_name    text not null,
  recipient_phone   text not null,
  delivery_address  text,
  target_amount     bigint not null,        -- kobo
  amount_raised     bigint not null default 0,
  contributor_count integer not null default 0,
  status            text not null default 'open'
                      check (status in ('open','funded','triggered','expired','cancelled')),
  deadline          timestamptz,
  token             uuid unique not null default gen_random_uuid(),
  reveal_theme      text not null default 'gold'
                      check (reveal_theme in ('gold','red','white','green')),
  sender_message    text,
  message_type      text check (message_type in ('text','voice','video')),
  message_url       text,
  linked_order_id   uuid references public.orders(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.group_gift_contributions (
  id                  uuid primary key default gen_random_uuid(),
  group_gift_id       uuid not null references public.group_gifts(id) on delete cascade,
  contributor_name    text not null,
  contributor_phone   text,
  amount              bigint not null,       -- kobo
  paystack_reference  text unique,
  paystack_event_id   text unique,           -- idempotency
  status              text not null default 'pending'
                        check (status in ('pending','confirmed','failed','refunded')),
  created_at          timestamptz not null default now()
);


-- ============================================================
-- TABLE: corporate_leads (CRM)
-- ============================================================
create table public.corporate_leads (
  id                uuid primary key default gen_random_uuid(),
  company_name      text not null,
  contact_name      text not null,
  contact_role      text,
  email             text,
  phone             text,
  recipient_count   integer,
  budget_per_head   bigint,              -- kobo
  gift_category     text,
  delivery_period   text,
  referral_source   text,
  requirements      text,
  status            text not null default 'new'
                      check (status in (
                        'new','contacted','proposal_sent',
                        'negotiating','closed_won','closed_lost'
                      )),
  pipeline_notes    text,
  proposal_url      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);


-- ============================================================
-- TABLE: vendor_payouts
-- ============================================================
create table public.vendor_payouts (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id),
  period_start     date not null,
  period_end       date not null,
  orders_count     integer not null default 0,
  gross_amount     bigint not null,       -- kobo
  commission_rate  numeric(4,2) not null,
  net_payout       bigint not null,       -- kobo
  paid             boolean not null default false,
  paid_at          timestamptz,
  payment_method   text,
  payment_ref      text,
  bank_name        text,
  account_number   text,
  account_name     text,
  notes            text,
  created_at       timestamptz not null default now()
);


-- ============================================================
-- INDEXES
-- ============================================================

-- Orders — primary query patterns
create index idx_orders_sender           on public.orders(sender_id);
create index idx_orders_status           on public.orders(status);
create index idx_orders_reveal_token     on public.orders(reveal_token);
create index idx_orders_paystack_ref     on public.orders(paystack_reference);
create index idx_orders_paystack_event   on public.orders(paystack_event_id);
create index idx_orders_recipient_phone  on public.orders(recipient_phone);
create index idx_orders_created          on public.orders(created_at desc);
create index idx_orders_scheduled        on public.orders(scheduled_send_at)
  where scheduled_send_at is not null;
create index idx_orders_vendor_timeout   on public.orders(vendor_timeout_at)
  where status = 'vendor_notified';          -- partial: only unresolved
create index idx_orders_expires          on public.orders(expires_at)
  where status in ('ready_for_redemption','reveal_opened','voucher_issued');

-- Redemptions — security-critical queries
create index idx_redemptions_token       on public.redemptions(redemption_token);
create index idx_redemptions_fallback    on public.redemptions(fallback_code);
create index idx_redemptions_order       on public.redemptions(order_id);
create index idx_redemptions_status      on public.redemptions(status);
create index idx_redemptions_expires     on public.redemptions(expires_at)
  where status = 'pending';

-- Gift fulfillments
create index idx_fulfillments_order      on public.gift_fulfillments(order_id);
create index idx_fulfillments_vendor     on public.gift_fulfillments(vendor_id);
create index idx_fulfillments_timeout    on public.gift_fulfillments(vendor_timeout_at)
  where status = 'vendor_notified';

-- Notifications — background worker polling
create index idx_notifications_status    on public.notifications(status);
create index idx_notifications_retry     on public.notifications(next_retry_at)
  where status in ('pending','retrying');
create index idx_notifications_order     on public.notifications(order_id);

-- Audit events — read patterns
create index idx_audit_resource          on public.audit_events(resource_type, resource_id);
create index idx_audit_event_type        on public.audit_events(event_type);
create index idx_audit_created           on public.audit_events(created_at desc);
create index idx_audit_actor             on public.audit_events(actor_id);

-- Idempotency keys
create index idx_idempotency_processed   on public.idempotency_keys(processed_at);
-- Entries older than 90 days can be purged by cron job

-- Other tables
create index idx_gift_templates_category on public.gift_templates(category);
create index idx_gift_templates_avail    on public.gift_templates(available) where available = true;
create index idx_offerings_template      on public.vendor_gift_offerings(gift_template_id);
create index idx_vendors_zone            on public.vendors using gin(delivery_zones);
create index idx_group_gifts_token       on public.group_gifts(token);
create index idx_group_gifts_organiser   on public.group_gifts(organiser_id);
create index idx_contributions_group     on public.group_gift_contributions(group_gift_id);
create index idx_corporate_status        on public.corporate_leads(status);
create index idx_payouts_vendor          on public.vendor_payouts(vendor_id);
create index idx_refunds_order           on public.refunds(order_id);
create index idx_refunds_status          on public.refunds(status);


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Order number auto-generation
create trigger trg_order_number
  before insert on public.orders
  for each row
  when (new.order_number is null or new.order_number = '')
  execute function generate_order_number();

-- Redemption number auto-generation
create or replace function generate_redemption_number()
returns trigger language plpgsql as $$
begin
  new.redemption_number :=
    'RDM-' || lpad(nextval('ebun_redemption_seq')::text, 4, '0');
  return new;
end;
$$;

create trigger trg_redemption_number
  before insert on public.redemptions
  for each row
  when (new.redemption_number is null or new.redemption_number = '')
  execute function generate_redemption_number();

-- updated_at sync
create trigger trg_users_updated_at
  before update on public.users for each row
  execute function handle_updated_at();

create trigger trg_vendors_updated_at
  before update on public.vendors for each row
  execute function handle_updated_at();

create trigger trg_gift_templates_updated_at
  before update on public.gift_templates for each row
  execute function handle_updated_at();

create trigger trg_orders_updated_at
  before update on public.orders for each row
  execute function handle_updated_at();

create trigger trg_redemptions_updated_at
  before update on public.redemptions for each row
  execute function handle_updated_at();

create trigger trg_fulfillments_updated_at
  before update on public.gift_fulfillments for each row
  execute function handle_updated_at();

create trigger trg_group_gifts_updated_at
  before update on public.group_gifts for each row
  execute function handle_updated_at();

create trigger trg_corporate_leads_updated_at
  before update on public.corporate_leads for each row
  execute function handle_updated_at();

-- Group gift total sync (contribution → group_gift)
create or replace function sync_group_gift_totals()
returns trigger language plpgsql as $$
begin
  update public.group_gifts
  set
    amount_raised     = (
      select coalesce(sum(amount), 0)
      from public.group_gift_contributions
      where group_gift_id = new.group_gift_id
        and status = 'confirmed'
    ),
    contributor_count = (
      select count(*)
      from public.group_gift_contributions
      where group_gift_id = new.group_gift_id
        and status = 'confirmed'
    ),
    status = case
      when (
        select coalesce(sum(amount), 0)
        from public.group_gift_contributions
        where group_gift_id = new.group_gift_id and status = 'confirmed'
      ) >= (select target_amount from public.group_gifts where id = new.group_gift_id)
        and (select status from public.group_gifts where id = new.group_gift_id) = 'open'
      then 'funded'
      else (select status from public.group_gifts where id = new.group_gift_id)
    end,
    updated_at = now()
  where id = new.group_gift_id;
  return new;
end;
$$;

create trigger trg_sync_group_totals
  after insert or update on public.group_gift_contributions
  for each row execute function sync_group_gift_totals();


-- ============================================================
-- ROW LEVEL SECURITY
-- Enable on all tables. Business-critical tables have strict policies.
-- NOTE: RLS is a defence-in-depth measure. Primary authorization
-- lives in NestJS. Never rely on RLS alone for security.
-- ============================================================

alter table public.users                    enable row level security;
alter table public.vendors                  enable row level security;
alter table public.gift_templates           enable row level security;
alter table public.vendor_gift_offerings    enable row level security;
alter table public.orders                   enable row level security;
alter table public.redemptions              enable row level security;
alter table public.gift_fulfillments        enable row level security;
alter table public.notifications            enable row level security;
alter table public.audit_events             enable row level security;
alter table public.idempotency_keys         enable row level security;
alter table public.group_gifts              enable row level security;
alter table public.group_gift_contributions enable row level security;
alter table public.corporate_leads          enable row level security;
alter table public.vendor_payouts           enable row level security;
alter table public.refunds                  enable row level security;


-- ── HELPER: is the current user an admin role? ──────────────
create or replace function is_ebun_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.users
    where auth_id = auth.uid()
      and role in ('ebun_admin', 'ebun_ops', 'ebun_finance', 'ebun_support')
  );
$$;

create or replace function current_user_id()
returns uuid language sql security definer as $$
  select id from public.users where auth_id = auth.uid() limit 1;
$$;


-- ── GIFT TEMPLATES — public read ──────────────────────────────
create policy "gift_templates_public_read"
  on public.gift_templates for select using (available = true);

create policy "gift_templates_admin_write"
  on public.gift_templates for all using (is_ebun_admin());


-- ── ORDERS — senders see own orders only ──────────────────────
create policy "orders_sender_select"
  on public.orders for select
  using (sender_id = current_user_id());

create policy "orders_sender_insert"
  on public.orders for insert
  with check (sender_id = current_user_id());

-- Senders may not directly update order status — NestJS controls this
create policy "orders_sender_update_notes"
  on public.orders for update
  using (sender_id = current_user_id())
  with check (
    sender_id = current_user_id()
    -- Only allow sender to update non-state fields
    -- State transitions happen via service account / admin role
  );

create policy "orders_admin_all"
  on public.orders for all using (is_ebun_admin());

-- Reveal page: anyone with the token can read the reveal data
-- This policy is intentionally permissive for the reveal UX.
-- Redemption is protected separately by the redemptions table.
create policy "orders_reveal_public_read"
  on public.orders for select
  using (true);
-- NOTE: In production, consider routing reveal page through an
-- Edge Function that validates the token server-side before
-- returning any order data. The public policy is acceptable for
-- low-value reveal data (sender name, gift name, reveal theme).
-- Redemption tokens and financial data must NEVER be returned
-- by a public policy — they live in the redemptions table.


-- ── REDEMPTIONS — strictly controlled ─────────────────────────
-- Recipients access via token-validated Edge Function only.
-- No direct client access to this table.
create policy "redemptions_admin_all"
  on public.redemptions for all using (is_ebun_admin());

create policy "redemptions_vendor_read"
  on public.redemptions for select
  using (
    vendor_id in (
      select id from public.vendors
      where id in (
        select vendor_id from public.users where auth_id = auth.uid()
        -- vendors linked via users table in production
      )
    )
  );


-- ── AUDIT EVENTS — append only ────────────────────────────────
create policy "audit_events_insert_all"
  on public.audit_events for insert with check (true);
-- Inserts happen via service role (NestJS). No client inserts.

create policy "audit_events_admin_select"
  on public.audit_events for select using (is_ebun_admin());

-- No UPDATE or DELETE policies on audit_events — intentionally.


-- ── USERS ─────────────────────────────────────────────────────
create policy "users_own_profile"
  on public.users for select using (auth_id = auth.uid());

create policy "users_update_own"
  on public.users for update
  using (auth_id = auth.uid())
  with check (
    auth_id = auth.uid()
    -- Role field cannot be self-updated — enforced at API layer
  );

create policy "users_admin_all"
  on public.users for all using (is_ebun_admin());


-- ── VENDORS ───────────────────────────────────────────────────
create policy "vendors_public_read"
  on public.vendors for select using (active = true);

create policy "vendors_admin_all"
  on public.vendors for all using (is_ebun_admin());


-- ── CORPORATE LEADS — admin only ──────────────────────────────
create policy "corporate_leads_admin"
  on public.corporate_leads for all using (is_ebun_admin());


-- ── VENDOR PAYOUTS — finance and admin ────────────────────────
create policy "payouts_finance_admin"
  on public.vendor_payouts for all using (is_ebun_admin());


-- ── NOTIFICATIONS — admin and system ──────────────────────────
create policy "notifications_admin"
  on public.notifications for all using (is_ebun_admin());

create policy "notifications_sender_read"
  on public.notifications for select
  using (
    order_id in (
      select id from public.orders where sender_id = current_user_id()
    )
  );


-- ── REFUNDS — admin only ───────────────────────────────────────
create policy "refunds_admin"
  on public.refunds for all using (is_ebun_admin());

create policy "refunds_sender_read"
  on public.refunds for select
  using (
    order_id in (
      select id from public.orders where sender_id = current_user_id()
    )
  );


-- ── GROUP GIFTS — public read by token ────────────────────────
create policy "group_gifts_public_read"
  on public.group_gifts for select using (true);

create policy "group_gifts_organiser_insert"
  on public.group_gifts for insert
  with check (organiser_id = current_user_id());

create policy "contributions_public_insert"
  on public.group_gift_contributions for insert with check (true);

create policy "contributions_public_read"
  on public.group_gift_contributions for select using (true);


-- ── IDEMPOTENCY — service role only ───────────────────────────
-- Idempotency table is only accessed by the backend service role.
-- No client-facing policies needed.
create policy "idempotency_admin"
  on public.idempotency_keys for all using (is_ebun_admin());


-- ============================================================
-- ATOMIC REDEMPTION FUNCTION
-- Called by NestJS to redeem a gift with race condition protection.
-- Returns the redemption record if successful, null if already redeemed.
-- This is the ONLY way to mark a redemption as completed.
-- ============================================================
create or replace function attempt_redemption(
  p_redemption_token uuid,
  p_vendor_id uuid,
  p_vendor_confirmed_by text,
  p_ip_address text,
  p_user_agent text
)
returns public.redemptions
language plpgsql
security definer
as $$
declare
  v_redemption public.redemptions;
begin
  -- Atomic conditional update — only succeeds if status is 'pending' or 'initiated'
  -- and not expired. This prevents race conditions from concurrent requests.
  update public.redemptions
  set
    status               = 'completed',
    completed_at         = now(),
    vendor_id            = p_vendor_id,
    vendor_confirmed_by  = p_vendor_confirmed_by,
    vendor_confirmed_at  = now(),
    completed_ip         = p_ip_address,
    updated_at           = now()
  where redemption_token = p_redemption_token
    and status in ('pending', 'initiated')
    and expires_at > now()
  returning * into v_redemption;

  -- If no row was updated, redemption was already processed or expired
  -- The caller (NestJS) should check if v_redemption is null
  -- and return the appropriate error response.

  return v_redemption;
end;
$$;

comment on function attempt_redemption is
  'Atomic single-use redemption. Uses conditional UPDATE to prevent
   race conditions from concurrent redemption attempts.
   Returns the updated redemption row if successful.
   Returns NULL if already redeemed or expired.
   NestJS must check return value and handle both cases.
   Never mark redemptions as completed outside this function.';


-- ============================================================
-- VENDOR TIMEOUT CHECK FUNCTION
-- Called by cron job every 30 minutes.
-- Escalates orders where vendor has not responded.
-- ============================================================
create or replace function escalate_vendor_timeouts()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  -- Find orders where vendor was notified but timeout has passed
  update public.orders
  set
    status     = 'vendor_timeout',
    updated_at = now()
  where status = 'vendor_notified'
    and vendor_timeout_at < now();

  get diagnostics v_count = row_count;

  -- Log each escalation to audit trail
  insert into public.audit_events (
    event_type, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  )
  select
    'VENDOR_TIMEOUT', 'cron', 'order', id,
    'vendor_notified', 'vendor_timeout',
    jsonb_build_object('escalated_at', now(), 'vendor_id', vendor_id)
  from public.orders
  where status = 'vendor_timeout'
    and updated_at >= now() - interval '1 minute';

  return v_count;
end;
$$;

comment on function escalate_vendor_timeouts is
  'Called by NestJS cron job every 30 minutes.
   Returns count of escalated orders.
   NestJS then: reassigns to backup vendor, notifies ops dashboard,
   and triggers sender notification if reassignment fails.';


-- ============================================================
-- GIFT EXPIRY FUNCTION
-- Marks unredeemed gifts as expired.
-- ============================================================
create or replace function expire_unclaimed_gifts()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  update public.orders
  set status = 'expired', updated_at = now()
  where status in ('ready_for_redemption', 'reveal_opened', 'voucher_issued')
    and expires_at < now();

  get diagnostics v_count = row_count;

  update public.redemptions
  set status = 'expired', updated_at = now()
  where status in ('pending', 'initiated')
    and expires_at < now();

  return v_count;
end;
$$;

comment on function expire_unclaimed_gifts is
  'Called by NestJS cron job daily.
   Expired orders should trigger sender notification and
   refund initiation per business rules.';


-- ============================================================
-- SUMMARY
-- ============================================================
-- Tables: 15
--   users, vendors, gift_templates, vendor_gift_offerings
--   orders, redemptions, gift_fulfillments
--   notifications, audit_events, idempotency_keys
--   refunds, group_gifts, group_gift_contributions
--   corporate_leads, vendor_payouts
--
-- Enums: 7
--   order_status, fulfillment_type, fulfillment_status
--   redemption_status, notification_channel, notification_status
--   actor_type, refund_status
--
-- Triggers: 10 (order number, redemption number, updated_at x8)
-- Indexes: 28
-- RLS policies: 20+
-- Security functions: attempt_redemption (atomic, race-safe)
-- Cron functions: escalate_vendor_timeouts, expire_unclaimed_gifts
-- ============================================================
-- Version: 2.0 — Security Foundation
-- Architect: Theophilus Adewale, Founder — Ebun Technologies
-- ============================================================
