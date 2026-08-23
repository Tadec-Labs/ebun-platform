import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { OrderStateMachineService } from './order-state-machine.service';
import { InvalidOrderTransitionException } from './exceptions/invalid-order-transition.exception';

const ALL_STATUSES = Object.values(OrderStatus);

describe('OrderStateMachineService', () => {
  let sut: OrderStateMachineService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [OrderStateMachineService],
    }).compile();
    sut = moduleRef.get(OrderStateMachineService);
  });

  // ---------------------------------------------------------------------
  // Coverage guard: every enum member must have an entry in both tables.
  // This does NOT derive any business rule — it's a regression test that
  // fails loudly if someone adds a new OrderStatus value and forgets to
  // wire it into order-state-machine.ts.
  // ---------------------------------------------------------------------
  describe('table coverage', () => {
    it.each(ALL_STATUSES)('has a NORMAL_TRANSITIONS entry for %s', (status) => {
      expect(sut.getNormalTransitions(status)).toBeDefined();
    });

    it.each(ALL_STATUSES)(
      'has an ADMIN_OVERRIDE_TRANSITIONS entry for %s',
      (status) => {
        expect(sut.getAdminOverrideTransitions(status)).toBeDefined();
      },
    );
  });

  // ---------------------------------------------------------------------
  // NORMAL_TRANSITIONS — SCHEMA-tagged edges (verbatim from the migration's
  // order_status comment block).
  // ---------------------------------------------------------------------
  describe('normal transitions — SCHEMA', () => {
    const schemaEdges: Array<[OrderStatus, OrderStatus]> = [
      [OrderStatus.Draft, OrderStatus.PendingPayment],
      [OrderStatus.PendingPayment, OrderStatus.Paid],
      [OrderStatus.PendingPayment, OrderStatus.PaymentFailed],
      [OrderStatus.Paid, OrderStatus.Processing],
      [OrderStatus.Processing, OrderStatus.VendorNotified],
      [OrderStatus.Processing, OrderStatus.FulfillmentInProgress],
      [OrderStatus.VendorNotified, OrderStatus.VendorAccepted],
      [OrderStatus.VendorNotified, OrderStatus.VendorDeclined],
      [OrderStatus.VendorNotified, OrderStatus.VendorTimeout],
      [OrderStatus.VendorAccepted, OrderStatus.FulfillmentInProgress],
      [OrderStatus.VendorDeclined, OrderStatus.Processing],
      [OrderStatus.VendorTimeout, OrderStatus.Processing],
      [OrderStatus.FulfillmentInProgress, OrderStatus.Dispatched],
      [OrderStatus.FulfillmentInProgress, OrderStatus.ReadyForRedemption],
      [OrderStatus.Dispatched, OrderStatus.Delivered],
      [OrderStatus.Delivered, OrderStatus.RevealOpened],
      [OrderStatus.Delivered, OrderStatus.Fulfilled],
      [OrderStatus.ReadyForRedemption, OrderStatus.RevealOpened],
      [OrderStatus.RevealOpened, OrderStatus.Redeemed],
      [OrderStatus.RevealOpened, OrderStatus.Expired],
      [OrderStatus.Redeemed, OrderStatus.Fulfilled],
    ];

    it.each(schemaEdges)('allows %s → %s', (from, to) => {
      expect(sut.isNormalTransition(from, to)).toBe(true);
      expect(() => sut.assertNormalTransition(from, to)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // NORMAL_TRANSITIONS — DERIVED edges (forced by executable schema code,
  // not just the comment).
  // ---------------------------------------------------------------------
  describe('normal transitions — DERIVED', () => {
    it('allows fulfillment_in_progress → voucher_issued (digital_voucher fulfillment path)', () => {
      expect(
        sut.isNormalTransition(
          OrderStatus.FulfillmentInProgress,
          OrderStatus.VoucherIssued,
        ),
      ).toBe(true);
    });

    it('allows voucher_issued → reveal_opened (mirrors ready_for_redemption)', () => {
      expect(
        sut.isNormalTransition(
          OrderStatus.VoucherIssued,
          OrderStatus.RevealOpened,
        ),
      ).toBe(true);
    });

    it('allows voucher_issued → expired (expire_unclaimed_gifts() batches this state)', () => {
      expect(
        sut.isNormalTransition(OrderStatus.VoucherIssued, OrderStatus.Expired),
      ).toBe(true);
    });

    it('allows ready_for_redemption → expired directly, without passing through reveal_opened (same expire_unclaimed_gifts() batch)', () => {
      expect(
        sut.isNormalTransition(
          OrderStatus.ReadyForRedemption,
          OrderStatus.Expired,
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // NORMAL_TRANSITIONS — INFERRED edges. These pass today because the code
  // matches what order-state-machine.ts declares, but the underlying
  // business rule is NOT confirmed by the schema. If product/ops resolves
  // one of these differently, update order-state-machine.ts AND this list
  // together.
  // ---------------------------------------------------------------------
  describe('normal transitions — INFERRED (needs product/ops confirmation)', () => {
    const inferredEdges: Array<[OrderStatus, OrderStatus]> = [
      [OrderStatus.VendorAccepted, OrderStatus.FulfillmentFailed],
      [OrderStatus.FulfillmentInProgress, OrderStatus.FulfillmentFailed],
      [OrderStatus.Dispatched, OrderStatus.FulfillmentFailed],
      [OrderStatus.RevealOpened, OrderStatus.RedemptionFailed],
    ];

    it.each(inferredEdges)('currently allows %s → %s', (from, to) => {
      expect(sut.isNormalTransition(from, to)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // ADMIN_OVERRIDE_TRANSITIONS
  // ---------------------------------------------------------------------
  describe('admin override transitions', () => {
    it('allows cancelled only from draft, pending_payment, vendor_declined, vendor_timeout', () => {
      const cancellableFrom = [
        OrderStatus.Draft,
        OrderStatus.PendingPayment,
        OrderStatus.VendorDeclined,
        OrderStatus.VendorTimeout,
      ];
      for (const status of ALL_STATUSES) {
        const expected = cancellableFrom.includes(status);
        expect(
          sut.isAdminOverrideTransition(status, OrderStatus.Cancelled),
        ).toBe(expected);
      }
    });

    it('allows refunded from every state except draft, pending_payment, payment_failed, cancelled, refunded itself', () => {
      const neverRefundable = [
        OrderStatus.Draft,
        OrderStatus.PendingPayment,
        OrderStatus.PaymentFailed,
        OrderStatus.Cancelled,
        OrderStatus.Refunded,
      ];
      for (const status of ALL_STATUSES) {
        const expected = !neverRefundable.includes(status);
        expect(
          sut.isAdminOverrideTransition(status, OrderStatus.Refunded),
        ).toBe(expected);
      }
    });

    it('leaves vendor_declined/vendor_timeout → cancelled|refunded UNRESOLVED (both legal, business rule not yet decided)', () => {
      for (const status of [
        OrderStatus.VendorDeclined,
        OrderStatus.VendorTimeout,
      ]) {
        expect(
          sut.isAdminOverrideTransition(status, OrderStatus.Cancelled),
        ).toBe(true);
        expect(
          sut.isAdminOverrideTransition(status, OrderStatus.Refunded),
        ).toBe(true);
      }
    });

    it('does not throw for a legal admin override', () => {
      expect(() =>
        sut.assertAdminOverrideTransition(
          OrderStatus.Fulfilled,
          OrderStatus.Refunded,
        ),
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // Normal vs admin-override separation — the actual security property.
  // ---------------------------------------------------------------------
  describe('normal/admin-override separation', () => {
    it('does not allow an admin-only edge through assertNormalTransition', () => {
      // paid → refunded is a legal ADMIN override, but is NOT a normal
      // pipeline transition. A payments-webhook handler calling
      // assertNormalTransition must not be able to walk an order to
      // refunded by accident.
      expect(
        sut.isAdminOverrideTransition(OrderStatus.Paid, OrderStatus.Refunded),
      ).toBe(true);
      expect(
        sut.isNormalTransition(OrderStatus.Paid, OrderStatus.Refunded),
      ).toBe(false);
      expect(() =>
        sut.assertNormalTransition(OrderStatus.Paid, OrderStatus.Refunded),
      ).toThrow(InvalidOrderTransitionException);
    });

    it('does not allow a normal-pipeline edge through assertAdminOverrideTransition', () => {
      expect(
        sut.isNormalTransition(OrderStatus.Draft, OrderStatus.PendingPayment),
      ).toBe(true);
      expect(
        sut.isAdminOverrideTransition(
          OrderStatus.Draft,
          OrderStatus.PendingPayment,
        ),
      ).toBe(false);
      expect(() =>
        sut.assertAdminOverrideTransition(
          OrderStatus.Draft,
          OrderStatus.PendingPayment,
        ),
      ).toThrow(InvalidOrderTransitionException);
    });

    it('canTransition() reports true when EITHER map allows the edge', () => {
      expect(
        sut.canTransition(OrderStatus.Draft, OrderStatus.PendingPayment),
      ).toBe(true); // normal only
      expect(sut.canTransition(OrderStatus.Paid, OrderStatus.Refunded)).toBe(
        true,
      ); // admin only
    });
  });

  // ---------------------------------------------------------------------
  // Invalid transitions — representative nonsensical jumps.
  // ---------------------------------------------------------------------
  describe('invalid transitions', () => {
    const invalidEdges: Array<[OrderStatus, OrderStatus]> = [
      [OrderStatus.Draft, OrderStatus.Fulfilled], // skips the entire pipeline
      [OrderStatus.Draft, OrderStatus.Paid], // skips pending_payment / webhook verification
      [OrderStatus.Paid, OrderStatus.Dispatched], // skips processing/vendor/fulfillment
      [OrderStatus.Fulfilled, OrderStatus.Draft], // backwards
      [OrderStatus.Redeemed, OrderStatus.RevealOpened], // backwards
      [OrderStatus.Cancelled, OrderStatus.PendingPayment], // resurrecting an absorbing state
      [OrderStatus.Refunded, OrderStatus.Paid], // resurrecting an absorbing state
      [OrderStatus.ReadyForRedemption, OrderStatus.Redeemed], // must pass through reveal_opened first
      [OrderStatus.VendorNotified, OrderStatus.FulfillmentInProgress], // must go through vendor_accepted first
    ];

    it.each(invalidEdges)('rejects %s → %s', (from, to) => {
      expect(sut.canTransition(from, to)).toBe(false);
      expect(() => sut.assertNormalTransition(from, to)).toThrow(
        InvalidOrderTransitionException,
      );
      expect(() => sut.assertAdminOverrideTransition(from, to)).toThrow(
        InvalidOrderTransitionException,
      );
    });

    it('same-state "transitions" are not implicitly allowed', () => {
      for (const status of ALL_STATUSES) {
        expect(sut.canTransition(status, status)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------
  // Terminal states.
  // ---------------------------------------------------------------------
  describe('isTerminal', () => {
    it('is true only for payment_failed, cancelled, refunded (zero exits under either map)', () => {
      expect(sut.isTerminal(OrderStatus.PaymentFailed)).toBe(true);
      expect(sut.isTerminal(OrderStatus.Cancelled)).toBe(true);
      expect(sut.isTerminal(OrderStatus.Refunded)).toBe(true);
    });

    it('is false for fulfilled/expired/fulfillment_failed/redemption_failed — no normal exit, but still admin-refundable', () => {
      const refundableButNoNormalExit = [
        OrderStatus.Fulfilled,
        OrderStatus.Expired,
        OrderStatus.FulfillmentFailed,
        OrderStatus.RedemptionFailed,
      ];
      for (const status of refundableButNoNormalExit) {
        expect(sut.getNormalTransitions(status)).toHaveLength(0);
        expect(sut.getAdminOverrideTransitions(status).length).toBeGreaterThan(
          0,
        );
        expect(sut.isTerminal(status)).toBe(false);
      }
    });

    it('is false for every non-terminal in-flight state', () => {
      const inFlight = [
        OrderStatus.Draft,
        OrderStatus.PendingPayment,
        OrderStatus.Paid,
        OrderStatus.Processing,
        OrderStatus.VendorNotified,
        OrderStatus.VendorAccepted,
        OrderStatus.VendorDeclined,
        OrderStatus.VendorTimeout,
        OrderStatus.FulfillmentInProgress,
        OrderStatus.Dispatched,
        OrderStatus.Delivered,
        OrderStatus.VoucherIssued,
        OrderStatus.ReadyForRedemption,
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
      ];
      for (const status of inFlight) {
        expect(sut.isTerminal(status)).toBe(false);
      }
    });
  });
});
