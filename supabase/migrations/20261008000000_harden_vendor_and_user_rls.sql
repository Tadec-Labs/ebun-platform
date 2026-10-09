-- RLS hardening, found while building the ops vendor admin (which is the
-- first feature to store real vendor bank details). Two gaps in the
-- original schema, both reachable by anyone holding the Supabase anon key
-- and a normal user session — i.e. via PostgREST, bypassing NestJS entirely.
-- The API itself is unaffected: it uses the service-role key, which
-- bypasses RLS, so nothing in apps/api changes.

-- 1. vendors_public_read let anyone SELECT every column of every active
--    vendor — including bank_name, account_number, account_name,
--    commission_rate and internal notes. RLS is row-level, not
--    column-level, so "public read" on this table can never be safe.
--    Senders never see vendors (assignment is invisible to them by
--    design), so there is no public use for it. If a vendor portal later
--    needs a vendor to read their OWN row, add a policy scoped to that
--    vendor's linked users row rather than reviving a public one.
--    (redemptions_vendor_read subqueries vendors; it is unused today —
--    every redemption goes through the API — and will need that own-row
--    policy before a vendor-facing client can rely on it.)
drop policy if exists "vendors_public_read" on public.vendors;

-- 2. users_update_own let any signed-in user UPDATE their own row,
--    including role. Its comment said "enforced at API layer", but nothing
--    enforced it, and the API's StaffGuard trusts users.role — so a user
--    could promote themselves to ebun_admin with a single PostgREST call.
--    A trigger rather than a tighter policy: a WITH CHECK that compares
--    against the old row has to read public.users from inside a users
--    policy, which recurses.
--
--    auth.uid() is NULL for the service-role key and for direct database
--    connections (migrations, the SQL editor), so the API and operators
--    can still change these columns; only end-user JWT sessions are
--    blocked — staff included, on purpose: role changes go through the API.
create or replace function public.guard_users_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
       new.role      is distinct from old.role
    or new.auth_id   is distinct from old.auth_id
    or new.is_active is distinct from old.is_active
  ) then
    raise exception 'role, auth_id and is_active can only be changed by the API'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_guard_privileged_columns on public.users;
create trigger trg_users_guard_privileged_columns
  before update on public.users
  for each row execute function public.guard_users_privileged_columns();
