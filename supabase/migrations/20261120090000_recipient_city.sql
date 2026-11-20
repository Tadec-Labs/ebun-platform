-- Recipient city first.
--
-- Until now the gift list was one national list, so a sender could buy
-- an Akure spa day for someone in Lagos and only find out after paying.
-- From here the sender says where the recipient is before seeing any
-- gift, and only gifts that a shop in that city can hand over are shown
-- and sold there. Airtime, data and power need no shop and stay
-- available everywhere.
--
-- cities is the short list SendEbun serves. A city that is not `live`
-- is known but not open yet (it shows as "coming soon"). Shops belong to
-- one city; an order records the recipient's city so delivery and
-- collection only ever involve shops in that city.
--
-- city_requests is demand we can't serve yet: a sender whose recipient
-- is somewhere we don't cover tells us where. That list decides which
-- city opens next.
--
-- Service role only, like every other table: RLS on, no policies.

create table public.cities (
  slug        text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  name        text not null check (char_length(name) between 2 and 60),
  state       text check (state is null or char_length(state) <= 60),
  live        boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.cities is
  'Cities SendEbun serves. live = senders can pick it and shops there sell; not live = known, not open yet.';

alter table public.cities enable row level security;

-- Akure is the pilot city and the only one open today.
insert into public.cities (slug, name, state, live, sort_order)
values ('akure', 'Akure', 'Ondo', true, 10)
on conflict (slug) do nothing;

-- Shops ----------------------------------------------------------------
alter table public.vendors
  add column city_slug text references public.cities(slug) on update cascade;

comment on column public.vendors.city_slug is
  'The city this shop serves. A shop with no city sells nothing that needs a shop, anywhere, until ops sets one.';

-- Every shop signed so far is in Akure (the pilot). New shops get their
-- city when ops adds them; anything filed here by mistake is one edit in
-- /ops away from right.
update public.vendors set city_slug = 'akure' where city_slug is null;

create index idx_vendors_city on public.vendors (city_slug) where active;

-- Orders ---------------------------------------------------------------
alter table public.orders
  add column recipient_city_slug text references public.cities(slug) on update cascade;

comment on column public.orders.recipient_city_slug is
  'Where the recipient is, as the sender said before choosing. Delivery and collection only use shops in this city. Null on orders made before this existed (and on company/group orders until those flows ask).';

-- Demand we can't serve yet -------------------------------------------
create table public.city_requests (
  id          uuid primary key default gen_random_uuid(),
  city        text not null check (char_length(city) between 2 and 80),
  -- Optional: an email or phone to tell when the city opens.
  contact     text check (contact is null or char_length(contact) <= 254),
  source      text not null default 'send' check (source in ('send', 'group', 'event', 'company')),
  created_at  timestamptz not null default now()
);

comment on table public.city_requests is
  'A sender wanted to gift someone in a city SendEbun does not serve yet. Read in /ops to choose the next city.';

alter table public.city_requests enable row level security;

create index idx_city_requests_created on public.city_requests (created_at desc);
