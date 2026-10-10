-- Put the two "Delivered" templates back to what they actually are, and
-- off sale.
--
-- What went wrong. 20261009000000_withhold_physical_gift_templates.sql
-- set both to available = false while leaving delivery_type = 'physical'.
-- Correct. But UpdateGiftTemplateDto.deliveryType accepted only
-- CREATABLE_DELIVERY_TYPES (digital_voucher | vtu), and the ops gift
-- form's select could only render those two and always submitted one.
-- So opening 'A Pizza, Delivered' in the form for ANY reason — including
-- just flipping the on-sale toggle — rewrote delivery_type to
-- 'digital_voucher' and put it back on sale at ₦9,500 as a collection
-- voucher. A sender paying the ₦1,500 premium over 'A Pizza, On Him'
-- was buying a delivery that does not exist, and would have received a
-- collection code instead — for a vendor that also does not exist.
--
-- The form and the DTO are fixed in the same change as this migration
-- (deliveryType is now rejected on update and rendered read-only), so
-- this cannot recur. This migration repairs the data that bug produced.
--
-- Matching on name AND on the delivery types either side of the bug, so
-- re-running this is a no-op and it cannot touch a legitimately
-- different template that happens to share a name later.
update public.gift_templates
   set delivery_type = 'physical',
       available     = false,
       updated_at    = now()
 where name in ('A Pizza, Delivered', 'A Burger, Delivered')
   and delivery_type in ('physical', 'digital_voucher');

-- Deliberately NOT deleted. Orders already reference these templates
-- (the four stuck 'A Pizza, Delivered' orders from 2-5 Oct among them),
-- and GiftsService.findById ignores `available` precisely so an order
-- placed against a withheld template still resolves. Deleting the rows
-- would orphan those orders and break their audit trail.
--
-- Flipping available back to true is the last step of building physical
-- fulfilment, not a separate decision.
