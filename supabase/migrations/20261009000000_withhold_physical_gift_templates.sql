-- Withhold the two delivered (physical) gift templates from the public
-- catalog until physical fulfillment actually exists.
--
-- Why this matters right now: FulfillmentOrchestratorService handles
-- digital_voucher and vtu only. A paid physical order reaches
-- 'processing', raises UnsupportedFulfillmentTypeException, and stops
-- there — and because PaystackWebhookService has already claimed the
-- webhook's idempotency key by then, a redelivery never retries it.
-- The sender sees "Payment received" and the recipient's link never
-- becomes ready. In test mode that costs nothing; with live Paystack
-- keys it is money taken for a gift that cannot be delivered and that
-- nothing will automatically refund.
--
-- `available` is the right lever, not deletion: GiftsService.listAvailable
-- filters on it for the catalog, while findById deliberately ignores it
-- so an order already placed against one of these templates still
-- resolves. Flipping this back to true is the last step of building
-- physical fulfillment, not a separate decision.
update public.gift_templates
   set available = false
 where delivery_type = 'physical'
   and name in ('A Pizza, Delivered', 'A Burger, Delivered');
