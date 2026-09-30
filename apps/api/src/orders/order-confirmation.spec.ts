import { OrderStatus } from '@ebun/types';
import {
  OrderConfirmationStatus,
  toConfirmationStatus,
} from './order-confirmation';

// Every OrderStatus listed explicitly, on purpose: the mapper defaults
// unknown statuses to 'confirmed', so a new enum member added later would
// be silently bucketed as "payment received". The exhaustiveness check
// below fails the moment that happens, forcing a deliberate decision.
const EXPECTED: Record<OrderStatus, OrderConfirmationStatus> = {
  [OrderStatus.Draft]: 'awaiting_payment',
  [OrderStatus.PendingPayment]: 'awaiting_payment',
  [OrderStatus.PaymentFailed]: 'unsuccessful',
  [OrderStatus.Cancelled]: 'unsuccessful',
  [OrderStatus.Refunded]: 'unsuccessful',
  [OrderStatus.Paid]: 'confirmed',
  [OrderStatus.Processing]: 'confirmed',
  [OrderStatus.VendorNotified]: 'confirmed',
  [OrderStatus.VendorAccepted]: 'confirmed',
  [OrderStatus.VendorDeclined]: 'confirmed',
  [OrderStatus.VendorTimeout]: 'confirmed',
  [OrderStatus.FulfillmentInProgress]: 'confirmed',
  [OrderStatus.Dispatched]: 'confirmed',
  [OrderStatus.Delivered]: 'confirmed',
  [OrderStatus.VoucherIssued]: 'confirmed',
  [OrderStatus.ReadyForRedemption]: 'confirmed',
  [OrderStatus.RevealOpened]: 'confirmed',
  [OrderStatus.Redeemed]: 'confirmed',
  [OrderStatus.Fulfilled]: 'confirmed',
  [OrderStatus.FulfillmentFailed]: 'confirmed',
  [OrderStatus.RedemptionFailed]: 'confirmed',
  [OrderStatus.Expired]: 'confirmed',
};

describe('toConfirmationStatus', () => {
  it.each(Object.entries(EXPECTED))('%s -> %s', (status, expected) => {
    expect(toConfirmationStatus(status as OrderStatus)).toBe(expected);
  });

  it('has an explicit expectation for every OrderStatus', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      Object.values(OrderStatus).sort(),
    );
  });
});
