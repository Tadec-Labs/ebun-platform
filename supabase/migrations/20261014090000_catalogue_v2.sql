-- Catalogue v2: categories that describe the gifts people actually send,
-- occasions to browse by, and how a collected gift is redeemed.
--
-- Same lists as packages/types/src/gift-catalogue.ts. Change both together.

-- Categories ---------------------------------------------------------------
alter table public.gift_templates drop constraint if exists gift_templates_category_check;
alter table public.vendors        drop constraint if exists vendors_category_check;

-- Existing rows move to their nearest new home. Ops can re-file anything
-- that lands in the wrong place (a bakery filed as "dine", say).
update public.gift_templates set category = case category
  when 'food' then 'dine'
  when 'experience' then 'experiences'
  when 'keepsake' then 'flowers'
  else category end;
update public.vendors set category = case category
  when 'food' then 'dine'
  when 'experience' then 'experiences'
  when 'keepsake' then 'flowers'
  else category end;

alter table public.gift_templates add constraint gift_templates_category_check
  check (category in ('treats','dine','pamper','experiences','hampers','flowers','utility'));
alter table public.vendors add constraint vendors_category_check
  check (category in ('treats','dine','pamper','experiences','hampers','flowers','utility'));

-- Occasions (column exists since the initial schema, unused until now) -----
update public.gift_templates set occasions = '{}' where occasions is null;
alter table public.gift_templates
  alter column occasions set default '{}',
  alter column occasions set not null,
  add constraint gift_templates_occasions_check
    check (occasions <@ array['birthday','thank_you','congratulations','love',
                              'just_because','get_well','new_baby','festive']::text[]);

-- Booking style ------------------------------------------------------------
-- 'pickup': "When are you collecting?" (a cake, a meal to take away)
-- 'appointment': "Book your appointment" (a massage, a table, a session)
alter table public.gift_templates
  add column booking_style text not null default 'pickup'
    check (booking_style in ('pickup','appointment'));

create index idx_gift_templates_occasions on public.gift_templates using gin (occasions);
