-- Company accounts: a company signs in, with teammates, and runs many
-- campaigns from one place, instead of one emailed link per campaign.
--
-- A company is the account; people belong to it through
-- company_members. Sign-in is Supabase Auth (email + password); the API
-- maps the signed-in user to their company through company_members.
--
-- One company per person in v1 (unique email and auth_id below). It
-- keeps "which company am I acting for?" out of every screen and every
-- request; lifting it later means a company switcher, not a migration
-- of existing data.
--
-- Campaigns gain an optional company_id. Campaigns made before this
-- (ops-created or emailed-link) keep working through their portal link
-- exactly as before; they just don't appear on a company dashboard.
--
-- Service role only, like every other table: RLS on, no policies.

create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  -- Shown to recipients ("PayGo sent you a treat").
  display_name  text not null check (char_length(display_name) between 2 and 120),
  legal_name    text check (char_length(legal_name) <= 200),
  billing_email text,
  rc_number     text check (char_length(rc_number) <= 40),
  tin           text check (char_length(tin) <= 40),
  status        text not null default 'active' check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.companies is
  'A business account. Members sign in and run campaigns; suspended companies cannot sign in.';

create trigger trg_companies_updated_at
  before update on public.companies for each row
  execute function handle_updated_at();

create table public.company_members (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- Lower-cased. An invite is a row with this email and no auth_id yet.
  email        text not null check (email = lower(email) and char_length(email) between 3 and 254),
  -- Supabase auth.users id, set when the person first signs in.
  auth_id      uuid,
  role         text not null default 'member' check (role in ('owner', 'member')),
  invited_by   uuid references public.company_members(id) on delete set null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.company_members is
  'People in a company. owner: team and company details; member: campaigns. Pending invite = auth_id is null.';

create unique index company_members_email_key on public.company_members (email);
create unique index company_members_auth_id_key on public.company_members (auth_id) where auth_id is not null;
create index company_members_company_idx on public.company_members (company_id);

alter table public.campaigns
  add column company_id uuid references public.companies(id) on delete set null;

create index campaigns_company_idx on public.campaigns (company_id, created_at desc)
  where company_id is not null;

alter table public.companies enable row level security;
alter table public.company_members enable row level security;

-- Creates a company and its first owner in one transaction, so a failed
-- owner insert (that email already belongs to a company) can't leave an
-- orphan company behind.
create or replace function public.create_company_with_owner(
  p_display_name text,
  p_email text,
  p_auth_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  insert into public.companies (display_name)
  values (p_display_name)
  returning id into v_company;

  insert into public.company_members (company_id, email, auth_id, role, accepted_at)
  values (v_company, lower(p_email), p_auth_id, 'owner', now());

  return v_company;
end;
$$;

revoke all on function public.create_company_with_owner(text, text, uuid) from public, anon, authenticated;
