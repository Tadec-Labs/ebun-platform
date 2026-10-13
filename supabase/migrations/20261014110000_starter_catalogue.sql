-- Starter catalogue for the six gift categories: something to sell in
-- each, so the /send filters have content once vendors sign up.
--
-- Every row goes in OFF SALE (available = false). Nothing here reaches a
-- sender until ops (1) sets the real price from a vendor's quote and
-- (2) a vendor offers it — the public catalogue hides any gift with no
-- vendor. Prices are indicative Lagos prices so the list reads sensibly
-- in /ops; they are not a pricing decision.
--
-- Doorstep gifts (physical) carry no delivery cost in base_price: the
-- delivery fee is its own line at checkout (DELIVERY_FEE_KOBO) and goes
-- to the vendor who delivers. Appointment gifts (spa, studio, a table)
-- are collection vouchers with booking_style 'appointment'.
--
-- Idempotent: each row is inserted only if no template already has that
-- name, so re-running this, or ops having created one by hand first,
-- changes nothing.

insert into public.gift_templates
  (name, description, category, base_price, delivery_type, delivery_window,
   requires_address, available, featured, sort_order, occasions, booking_style)
select v.name, v.description, v.category, v.base_price, v.delivery_type::fulfillment_type,
       v.delivery_window, v.delivery_type = 'physical', false, false, v.sort_order,
       v.occasions, v.booking_style
from (values
  -- Treats ---------------------------------------------------------------
  ('Celebration Cake',
   'A freshly baked cake with their name piped on top, delivered to their door.',
   'treats', 2500000, 'physical', 'Next day if ordered by 4pm', 20,
   array['birthday','congratulations','love'], 'pickup'),
  ('Cupcake Box',
   'Six assorted cupcakes, boxed and delivered.',
   'treats', 1200000, 'physical', 'Same day if ordered by 1pm', 21,
   array['birthday','thank_you','just_because'], 'pickup'),
  ('Small Chops Tray',
   'Puff-puff, samosa, spring rolls and peppered gizzard for a small gathering.',
   'treats', 1800000, 'physical', 'Next day if ordered by 4pm', 22,
   array['birthday','congratulations','festive'], 'pickup'),

  -- Dine -----------------------------------------------------------------
  ('Dinner for Two',
   'Dinner for two at a partner restaurant. They pick the evening; the restaurant confirms the table.',
   'dine', 4000000, 'digital_voucher', 'Valid for 30 days', 30,
   array['love','birthday','congratulations'], 'appointment'),
  ('Brunch for Two',
   'Weekend brunch for two — mains and drinks — at a partner spot.',
   'dine', 3000000, 'digital_voucher', 'Valid for 30 days', 31,
   array['birthday','thank_you','just_because'], 'pickup'),

  -- Pamper ---------------------------------------------------------------
  ('Weekend Spa Package',
   'Full-body massage, facial and steam at a partner spa. They book the slot that suits them.',
   'pamper', 6000000, 'digital_voucher', 'Valid for 30 days', 40,
   array['birthday','love','thank_you','just_because'], 'appointment'),
  ('Massage, 60 Minutes',
   'An hour''s massage at a partner spa, booked at a time that suits them.',
   'pamper', 3000000, 'digital_voucher', 'Valid for 30 days', 41,
   array['birthday','thank_you','get_well','just_because'], 'appointment'),
  ('Mani-Pedi',
   'Manicure and pedicure at a partner salon.',
   'pamper', 1500000, 'digital_voucher', 'Valid for 30 days', 42,
   array['birthday','just_because','thank_you'], 'appointment'),

  -- Experiences ----------------------------------------------------------
  ('Cinema for Two',
   'Two cinema tickets with popcorn and drinks.',
   'experiences', 1200000, 'digital_voucher', 'Valid for 30 days', 50,
   array['love','birthday','just_because'], 'pickup'),
  ('Paint & Sip for Two',
   'A guided painting session with drinks for two. They book the session.',
   'experiences', 2500000, 'digital_voucher', 'Valid for 60 days', 51,
   array['love','birthday','congratulations'], 'appointment'),

  -- Hampers & care -------------------------------------------------------
  ('Grocery Hamper — Essentials',
   'Rice, vegetable oil, spaghetti, tomato paste, noodles, sugar, milk and seasoning — the weekly basics, delivered.',
   'hampers', 3500000, 'physical', 'Within 24 hours', 60,
   array['just_because','thank_you','new_baby','festive'], 'pickup'),
  ('Grocery Hamper — Family',
   'A full month''s staples for a family: bag of rice, oil, beans, garri, pasta, tin tomatoes, beverages and more.',
   'hampers', 7500000, 'physical', 'Within 24 hours', 61,
   array['festive','thank_you','new_baby','just_because'], 'pickup'),
  ('Breakfast Hamper',
   'Bread, eggs, cereal, tea and coffee, juice, butter and spreads — breakfast sorted for the week.',
   'hampers', 2500000, 'physical', 'Next morning if ordered by 6pm', 62,
   array['just_because','get_well','thank_you'], 'pickup'),
  ('New Baby Care Box',
   'Diapers, wipes, baby wash, a swaddle and a treat for the new parents.',
   'hampers', 4000000, 'physical', 'Within 24 hours', 63,
   array['new_baby'], 'pickup'),
  ('Get Well Hamper',
   'Fruit, juice, soup, tea and a few comforts for someone resting up.',
   'hampers', 2500000, 'physical', 'Same day if ordered by 1pm', 64,
   array['get_well'], 'pickup'),
  ('Festive Hamper',
   'Wine, chocolates, biscuits, nuts and premium treats in a gift box.',
   'hampers', 6000000, 'physical', 'Within 24 hours', 65,
   array['festive','thank_you','congratulations'], 'pickup'),

  -- Flowers & keepsakes --------------------------------------------------
  ('Hand-tied Bouquet',
   'Seasonal flowers, hand-tied and delivered with a card.',
   'flowers', 3000000, 'physical', 'Same day if ordered by 1pm', 70,
   array['love','birthday','congratulations','get_well','thank_you'], 'pickup'),
  ('Roses & Chocolates',
   'A dozen red roses and a box of chocolates, delivered.',
   'flowers', 4000000, 'physical', 'Same day if ordered by 1pm', 71,
   array['love','birthday'], 'pickup')
) as v(name, description, category, base_price, delivery_type, delivery_window,
       sort_order, occasions, booking_style)
where not exists (
  select 1 from public.gift_templates t where t.name = v.name
);

-- The two original delivered templates had delivery baked into their
-- price (₦1,500 over the collected version) because no delivery fee
-- existed. Now one does, and it is added at checkout — leaving these as
-- they were would charge senders for delivery twice. Matched on the
-- exact launch placeholder price so a price ops has since set by hand is
-- left alone. Existing orders are unaffected: each froze its own price.
update public.gift_templates
   set base_price = 800000, updated_at = now()
 where name = 'A Pizza, Delivered' and base_price = 950000;

update public.gift_templates
   set base_price = 600000, updated_at = now()
 where name = 'A Burger, Delivered' and base_price = 750000;
