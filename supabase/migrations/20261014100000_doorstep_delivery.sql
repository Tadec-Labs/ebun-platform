-- Doorstep delivery for physical gifts (hampers, groceries, cakes, flowers).
--
-- The flow, using only order-state edges that already exist:
--
--   paid -> processing -> fulfillment_in_progress   (payment webhook)
--        recipient opens the link, scratches, gives an address
--        vendor is assigned and sees it under "To deliver"
--   fulfillment_in_progress -> dispatched           (vendor: "Out for delivery")
--   dispatched -> delivered                         (vendor or ops: "Delivered")
--        vendor credited: their item price + the delivery fee
--   delivered -> fulfilled                          (recipient unwraps the message)
--
-- The recipient gives the address, not the sender: senders often don't
-- know it, and asking them would mean asking the recipient, which spoils
-- the surprise. orders.delivery_address / delivery_zone already exist for
-- exactly this ("entered by recipient after reveal"); this adds the rest
-- of what a rider needs.
--
-- Who is delivering lives on gift_fulfillments.vendor_id (assigned when
-- the address arrives, changeable by ops). orders.vendor_id keeps its
-- existing meaning — who handed it over and is owed for it — and is
-- written at delivery, exactly as it is at collection.

alter table public.orders
  add column delivery_phone      text,
  add column delivery_note       text,
  add column delivery_details_at timestamptz;

comment on column public.orders.delivery_phone is
  'Number the rider calls on arrival, given by the recipient. Null = use recipient_phone.';
comment on column public.orders.delivery_note is
  'Landmark / gate / best time, in the recipient''s words. Shown to the delivering vendor.';
comment on column public.orders.delivery_details_at is
  'When the recipient last gave or changed the delivery address.';

-- The vendor's "To deliver" list and ops' open-deliveries view.
create index idx_gift_fulfillments_open_physical
  on public.gift_fulfillments (vendor_id, created_at)
  where fulfillment_type = 'physical' and delivered_at is null;
