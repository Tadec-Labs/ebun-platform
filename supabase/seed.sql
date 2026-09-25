-- Ebun local development seed data.
--
-- Launch catalog is food-only, per the actual MVP scope — not the
-- Product Brief's full four-category vision (experience/keepsake/
-- utility gift templates don't exist yet, on purpose). Both journeys
-- ship at launch, so each food item gets two rows: a digital_voucher
-- (pickup, redeem in person) and a physical (delivered) variant, since
-- delivery_type lives on the template, not chosen separately by the
-- sender. Prices are placeholders in kobo — ops owns the real numbers;
-- the small pickup/delivery gap here is just delivery_fee=0 baked into
-- base_price until a real fee schedule exists (see CreateOrderService's
-- own placeholder-fee comment).
insert into public.gift_templates
  (name, description, category, base_price, delivery_type, delivery_window, requires_address, featured, sort_order)
values
  ('A Pizza, On Him',
   'Redeemable at any partner pizza spot near you — pick your own toppings when you get there.',
   'food', 800000, 'digital_voucher', 'Redeemable anytime this week', false, true, 1),

  ('A Pizza, Delivered',
   'A full pizza, delivered straight to their door.',
   'food', 950000, 'physical', '2-4hrs', true, true, 2),

  ('A Burger, On Him',
   'Redeemable at any partner burger spot near you — fries and a drink included.',
   'food', 600000, 'digital_voucher', 'Redeemable anytime this week', false, false, 3),

  ('A Burger, Delivered',
   'A full burger combo, delivered straight to their door.',
   'food', 750000, 'physical', '2-4hrs', true, false, 4);