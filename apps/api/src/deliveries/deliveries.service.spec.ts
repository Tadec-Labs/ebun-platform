import { AutoPayoutsService } from '../payouts/auto-payouts.service';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FulfillmentStatus, FulfillmentType, OrderStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { VendorAlertsService } from '../alerts/vendor-alerts.service';
import { OrdersService } from '../orders/orders.service';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import {
  DeliveriesRepository,
  DeliveryCandidateRow,
  DeliveryFulfillmentRow,
  DeliveryOrderRow,
} from './deliveries.repository';
import { chooseVendor, DeliveriesService } from './deliveries.service';

function order(overrides: Partial<DeliveryOrderRow> = {}): DeliveryOrderRow {
  return {
    id: 'order-1',
    status: OrderStatus.FulfillmentInProgress,
    order_number: 'EBN-0001',
    gift_template_id: 'hamper',
    gift_value: 2_200_000,
    delivery_fee: 150_000,
    recipient_name: 'Ada Obi',
    recipient_phone: '+2348012345678',
    delivery_address: null,
    delivery_zone: null,
    delivery_phone: null,
    delivery_note: null,
    delivery_details_at: null,
    created_at: '2026-10-14T09:00:00.000Z',
    gift_templates: {
      name: 'Grocery Hamper',
      delivery_type: FulfillmentType.Physical,
      delivery_window: 'Same day before 2pm',
    },
    ...overrides,
  };
}

function fulfillment(
  overrides: Partial<DeliveryFulfillmentRow> = {},
): DeliveryFulfillmentRow {
  return {
    order_id: 'order-1',
    vendor_id: null,
    status: FulfillmentStatus.Pending,
    vendor_notified_at: null,
    vendor_accepted_at: null,
    rider_name: null,
    rider_phone: null,
    rider_dispatched_at: null,
    delivered_at: null,
    handover_code_attempts: 0,
    created_at: '2026-10-14T09:00:00.000Z',
    ...overrides,
  };
}

function candidate(
  id: string,
  overrides: Partial<DeliveryCandidateRow> = {},
  vendor: Partial<NonNullable<DeliveryCandidateRow['vendors']>> = {},
): DeliveryCandidateRow {
  return {
    vendor_price: 2_000_000,
    available: true,
    approved: true,
    vendors: {
      id,
      business_name: id,
      active: true,
      delivery_zones: [],
      service_areas: [],
      ...vendor,
    },
    ...overrides,
  };
}

describe('chooseVendor', () => {
  it('prefers a vendor taking orders that covers the area', () => {
    expect(
      chooseVendor(
        [
          candidate('far', {}, { delivery_zones: ['Ikeja'] }),
          candidate('near', {}, { delivery_zones: ['Lekki'] }),
        ],
        'Lekki Phase 1',
      ),
    ).toBe('near');
  });

  it('prefers taking orders over area match — a paused shop is the last resort', () => {
    expect(
      chooseVendor(
        [
          candidate(
            'paused-near',
            { available: false },
            { delivery_zones: ['Lekki'] },
          ),
          candidate('open-far'),
        ],
        'Lekki',
      ),
    ).toBe('open-far');
  });

  it('never picks an inactive vendor or an unapproved offering', () => {
    expect(
      chooseVendor(
        [
          candidate('off', {}, { active: false }),
          candidate('pending', { approved: false }),
        ],
        'Lekki',
      ),
    ).toBeNull();
  });
});

describe('DeliveriesService', () => {
  let sut: DeliveriesService;
  let repo: Record<keyof DeliveriesRepository, jest.Mock>;
  let orders: { transitionNormal: jest.Mock };
  let audit: { record: jest.Mock };
  let alerts: { newDelivery: jest.Mock };

  let autoPayouts: { payVendorSoon: jest.Mock };
  beforeEach(async () => {
    repo = {
      findOrder: jest.fn().mockResolvedValue(order()),
      findFulfillment: jest.fn().mockResolvedValue(fulfillment()),
      saveRecipientDetails: jest.fn().mockResolvedValue(true),
      assignVendor: jest.fn().mockResolvedValue(true),
      clearAcknowledgement: jest.fn().mockResolvedValue(undefined),
      acknowledge: jest.fn().mockResolvedValue(true),
      markDispatched: jest.fn().mockResolvedValue(true),
      markDelivered: jest.fn().mockResolvedValue(true),
      listCandidates: jest.fn().mockResolvedValue([candidate('vendor-1')]),
      vendorPayout: jest.fn().mockResolvedValue(2_000_000),
      vendorName: jest.fn().mockResolvedValue('Mama Put Hampers'),
      recordVendorCredit: jest.fn().mockResolvedValue(undefined),
      listOpen: jest.fn().mockResolvedValue([]),
      handoverCode: jest.fn().mockResolvedValue('4821'),
      tryHandoverCode: jest.fn().mockResolvedValue('ok'),
    };
    orders = { transitionNormal: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    alerts = { newDelivery: jest.fn().mockResolvedValue(undefined) };
    autoPayouts = { payVendorSoon: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: DeliveriesRepository, useValue: repo },
        { provide: OrdersService, useValue: orders },
        { provide: AuditService, useValue: audit },
        { provide: AutoPayoutsService, useValue: autoPayouts },
        { provide: VendorAlertsService, useValue: alerts },
      ],
    }).compile();
    sut = moduleRef.get(DeliveriesService);
  });

  describe('setRecipientDetails', () => {
    const details = {
      address: '  12   Admiralty Way ',
      area: 'Lekki Phase 1',
      phone: '',
      note: 'Blue gate',
    };

    it('saves the address and assigns a vendor on the first one', async () => {
      await sut.setRecipientDetails('order-1', details);

      expect(repo.saveRecipientDetails).toHaveBeenCalledWith('order-1', {
        address: '12 Admiralty Way',
        area: 'Lekki Phase 1',
        phone: null,
        note: 'Blue gate',
      });
      expect(repo.assignVendor).toHaveBeenCalledWith('order-1', 'vendor-1');
      // Email as well as the link — the fail-safe if WhatsApp is missed.
      expect(alerts.newDelivery).toHaveBeenCalledWith('order-1', 'vendor-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'order.delivery_details_added' }),
      );
    });

    it('puts a changed address back in front of the assigned vendor', async () => {
      repo.findOrder.mockResolvedValue(order({ delivery_address: 'Old' }));
      repo.findFulfillment.mockResolvedValue(
        fulfillment({ vendor_id: 'vendor-1', vendor_accepted_at: 'x' }),
      );

      await sut.setRecipientDetails('order-1', details);

      expect(repo.assignVendor).not.toHaveBeenCalled();
      expect(repo.clearAcknowledgement).toHaveBeenCalledWith('order-1');
    });

    it('refuses once a rider has it', async () => {
      repo.findFulfillment.mockResolvedValue(
        fulfillment({ vendor_id: 'vendor-1', rider_dispatched_at: 'x' }),
      );

      await expect(sut.setRecipientDetails('order-1', details)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.saveRecipientDetails).not.toHaveBeenCalled();
    });

    it('refuses a gift that is not delivered', async () => {
      repo.findOrder.mockResolvedValue(
        order({
          gift_templates: {
            name: 'Pizza',
            delivery_type: FulfillmentType.DigitalVoucher,
            delivery_window: null,
          },
        }),
      );

      await expect(sut.setRecipientDetails('order-1', details)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('still saves when no vendor can take it — ops assigns', async () => {
      repo.listCandidates.mockResolvedValue([]);

      await sut.setRecipientDetails('order-1', details);

      expect(repo.saveRecipientDetails).toHaveBeenCalled();
      expect(repo.assignVendor).not.toHaveBeenCalled();
    });
  });

  describe('markDelivered', () => {
    beforeEach(() => {
      repo.findOrder.mockResolvedValue(
        order({ delivery_address: '12 Admiralty Way' }),
      );
      repo.findFulfillment.mockResolvedValue(
        fulfillment({ vendor_id: 'vendor-1' }),
      );
    });

    it('goes straight from preparing to delivered and credits item + delivery fee', async () => {
      await sut.markDelivered(
        { kind: 'vendor', vendorId: 'vendor-1' },
        'order-1',
        '4821',
      );

      expect(repo.tryHandoverCode).toHaveBeenCalledWith(
        'order-1',
        'vendor-1',
        '4821',
      );

      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        1,
        'order-1',
        OrderStatus.FulfillmentInProgress,
        OrderStatus.Dispatched,
        { type: 'vendor' },
      );
      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        2,
        'order-1',
        OrderStatus.Dispatched,
        OrderStatus.Delivered,
        { type: 'vendor' },
      );
      expect(repo.markDelivered).toHaveBeenCalledWith('order-1', 'code');
      // The share is of what the sender paid for this order, not today's price.
      expect(repo.vendorPayout).toHaveBeenCalledWith(
        'vendor-1',
        'hamper',
        2_200_000,
      );
      expect(repo.recordVendorCredit).toHaveBeenCalledWith(
        'order-1',
        'vendor-1',
        2_150_000,
      );
      // Credited: the automatic payout is kicked off.
      expect(autoPayouts.payVendorSoon).toHaveBeenCalledWith('vendor-1');
    });

    it("hides another vendor's delivery behind the same 404 as a missing one", async () => {
      await expect(
        sut.markDelivered(
          { kind: 'vendor', vendorId: 'someone-else' },
          'order-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(orders.transitionNormal).not.toHaveBeenCalled();
    });

    it('turns a lost race into a plain conflict, and credits nothing', async () => {
      repo.findOrder.mockResolvedValue(
        order({ status: OrderStatus.Dispatched, delivery_address: 'x' }),
      );
      orders.transitionNormal.mockRejectedValue(
        new OrderTransitionConflictException(
          'order-1',
          OrderStatus.Dispatched,
          OrderStatus.Delivered,
        ),
      );

      await expect(
        sut.markDelivered({ kind: 'staff', userId: 'staff-1' }, 'order-1'),
      ).rejects.toThrow(ConflictException);
      expect(repo.recordVendorCredit).not.toHaveBeenCalled();
    });

    it("won't let a vendor mark it delivered without the recipient's code", async () => {
      await expect(
        sut.markDelivered({ kind: 'vendor', vendorId: 'vendor-1' }, 'order-1'),
      ).rejects.toThrow(/4-digit code/);
      expect(repo.tryHandoverCode).not.toHaveBeenCalled();
      expect(orders.transitionNormal).not.toHaveBeenCalled();
      expect(repo.recordVendorCredit).not.toHaveBeenCalled();
    });

    it('refuses a wrong code, says how many tries are left, and credits nothing', async () => {
      repo.tryHandoverCode.mockResolvedValue('wrong');
      repo.findFulfillment
        .mockResolvedValueOnce(fulfillment({ vendor_id: 'vendor-1' }))
        .mockResolvedValueOnce(
          fulfillment({ vendor_id: 'vendor-1', handover_code_attempts: 2 }),
        );

      await expect(
        sut.markDelivered(
          { kind: 'vendor', vendorId: 'vendor-1' },
          'order-1',
          '0000',
        ),
      ).rejects.toThrow(/3 tries left/);
      expect(orders.transitionNormal).not.toHaveBeenCalled();
      expect(repo.recordVendorCredit).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'order.handover_code_wrong' }),
      );
    });

    it('stops at five tries and points to the recipient or SendEbun', async () => {
      repo.tryHandoverCode.mockResolvedValue('locked');

      await expect(
        sut.markDelivered(
          { kind: 'vendor', vendorId: 'vendor-1' },
          'order-1',
          '4821',
        ),
      ).rejects.toThrow(ConflictException);
      expect(repo.recordVendorCredit).not.toHaveBeenCalled();
    });

    it('lets the recipient confirm it themselves, with no code, and credits the vendor', async () => {
      await sut.markDelivered({ kind: 'recipient' }, 'order-1');

      expect(repo.tryHandoverCode).not.toHaveBeenCalled();
      expect(orders.transitionNormal).toHaveBeenLastCalledWith(
        'order-1',
        OrderStatus.Dispatched,
        OrderStatus.Delivered,
        { type: 'user' },
      );
      expect(repo.markDelivered).toHaveBeenCalledWith('order-1', 'recipient');
      expect(repo.recordVendorCredit).toHaveBeenCalled();
    });

    it('lets staff confirm by hand, recorded as ops', async () => {
      await sut.markDelivered({ kind: 'staff', userId: 'staff-1' }, 'order-1');

      expect(repo.tryHandoverCode).not.toHaveBeenCalled();
      expect(repo.markDelivered).toHaveBeenCalledWith('order-1', 'ops');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'order.delivered',
          actorId: 'staff-1',
          metadata: expect.objectContaining({ confirmedBy: 'ops' }) as unknown,
        }),
      );
    });

    it("won't take a recipient's confirmation before there's an address", async () => {
      repo.findOrder.mockResolvedValue(order());

      await expect(
        sut.markDelivered({ kind: 'recipient' }, 'order-1'),
      ).rejects.toThrow(/address/);
      expect(orders.transitionNormal).not.toHaveBeenCalled();
    });

    it('says so when it is already delivered', async () => {
      repo.findOrder.mockResolvedValue(
        order({ status: OrderStatus.Delivered }),
      );

      await expect(
        sut.markDelivered({ kind: 'vendor', vendorId: 'vendor-1' }, 'order-1'),
      ).rejects.toThrow('Already marked as delivered.');
    });
  });

  it('will not send a rider out with no address', async () => {
    repo.findFulfillment.mockResolvedValue(
      fulfillment({ vendor_id: 'vendor-1' }),
    );

    await expect(
      sut.dispatch({ kind: 'vendor', vendorId: 'vendor-1' }, 'order-1'),
    ).rejects.toThrow(BadRequestException);
    expect(orders.transitionNormal).not.toHaveBeenCalled();
  });

  it("lists the vendor's deliveries with what they'll receive, skipping any with no address", async () => {
    repo.listOpen.mockResolvedValue([
      {
        ...fulfillment({ vendor_id: 'vendor-1', vendor_notified_at: 't1' }),
        orders: order({
          delivery_address: '12 Admiralty Way',
          delivery_zone: 'Lekki',
          delivery_note: 'Blue gate',
        }),
        vendors: null,
      },
      {
        ...fulfillment({ order_id: 'order-2', vendor_id: 'vendor-1' }),
        orders: order({ id: 'order-2' }),
        vendors: null,
      },
    ]);

    const list = await sut.listForVendor('vendor-1');

    expect(list).toEqual([
      expect.objectContaining({
        orderId: 'order-1',
        recipientName: 'Ada Obi',
        phone: '+2348012345678',
        address: '12 Admiralty Way',
        stage: 'new',
        youReceive: 2_150_000,
        codeLocked: false,
      }),
    ]);
    // The vendor never sees the recipient's handover code.
    expect(JSON.stringify(list)).not.toContain('4821');
    expect(repo.handoverCode).not.toHaveBeenCalled();
  });

  describe("the recipient's view", () => {
    it('shows the handover code only once there is an address and a shop', async () => {
      repo.findOrder.mockResolvedValue(order());
      repo.findFulfillment.mockResolvedValue(fulfillment());
      const before = await sut.forRecipient(
        'order-1',
        OrderStatus.FulfillmentInProgress,
      );
      expect(before?.handoverCode).toBeNull();
      expect(before?.canConfirmReceived).toBe(false);

      repo.findOrder.mockResolvedValue(
        order({ delivery_address: '12 Admiralty Way' }),
      );
      repo.findFulfillment.mockResolvedValue(
        fulfillment({ vendor_id: 'vendor-1' }),
      );
      const after = await sut.forRecipient(
        'order-1',
        OrderStatus.FulfillmentInProgress,
      );
      expect(after?.handoverCode).toBe('4821');
      expect(after?.canConfirmReceived).toBe(true);
    });

    it('stops showing the code once it has been delivered', async () => {
      repo.findOrder.mockResolvedValue(
        order({ delivery_address: '12 Admiralty Way' }),
      );
      repo.findFulfillment.mockResolvedValue(
        fulfillment({ vendor_id: 'vendor-1', delivered_at: 't' }),
      );
      const view = await sut.forRecipient('order-1', OrderStatus.Delivered);
      expect(view?.handoverCode).toBeNull();
      expect(view?.canConfirmReceived).toBe(false);
    });
  });
});
