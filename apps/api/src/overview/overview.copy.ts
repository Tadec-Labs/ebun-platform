import type { OpsDeliveryView } from '../deliveries/deliveries.service';

/** How a late delivery reads in the Today list. */
export const DELIVERY_STAGE_TITLE: Record<OpsDeliveryView['stage'], string> = {
  awaiting_address: 'no address yet',
  needs_vendor: 'needs a vendor',
  unacknowledged: 'vendor hasn’t seen it',
  preparing: 'still being prepared',
  on_the_way: 'still on its way',
  missed: 'couldn’t be delivered — waiting for collection',
};
