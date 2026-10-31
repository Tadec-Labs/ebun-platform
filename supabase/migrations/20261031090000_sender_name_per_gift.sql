-- The name on a gift is the name typed for THAT gift.
--
-- Guest senders are found-or-created by email (users.email is UNIQUE),
-- and the reveal used to show users.name. So the first name ever typed
-- with an email stuck to every later gift from it, and anyone typing
-- someone else's email sent under that person's name.
--
-- Now each order and each group gift keeps the name typed at checkout.
-- users.name is never overwritten from checkout: anyone can type any
-- email there, so it can't be allowed to rename an existing user.
--
-- Older rows stay null and the API falls back to users.name for them,
-- so nothing already sent changes what it shows.

alter table public.orders
  add column sender_name text;

alter table public.orders
  add constraint orders_sender_name_length
  check (sender_name is null or char_length(sender_name) between 1 and 200);

comment on column public.orders.sender_name is
  'The sender name typed at checkout for this gift. Shown on the reveal. Null for older orders, company gifts and group gifts (those show the company or the organiser).';

alter table public.group_gifts
  add column organiser_name text;

alter table public.group_gifts
  add constraint group_gifts_organiser_name_length
  check (organiser_name is null or char_length(organiser_name) between 1 and 120);

comment on column public.group_gifts.organiser_name is
  'The organiser name typed when the pot was started. Shown on the pot page and the reveal. Null for pots started before this column existed.';
