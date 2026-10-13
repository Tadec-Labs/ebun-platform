import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@ebun/types';
import { EmailSenderService } from './email-sender.service';
import { VendorAlertsRepository } from './vendor-alerts.repository';
import { VendorAlertsService } from './vendor-alerts.service';

const vendor = {
  id: 'vendor-1',
  business_name: 'Hamper House',
  email: 'orders@hamperhouse.ng',
  whatsapp_number: '+2348030000000',
  backup_phone: '+2348050000000',
};

const order = {
  id: 'order-1',
  order_number: 'EBN-0042',
  recipient_name: 'Ada Obi',
  recipient_phone: '+2348012345678',
  delivery_address: '12 Admiralty Way',
  delivery_zone: 'Lekki',
  delivery_phone: null,
  delivery_note: 'Blue gate',
  gift_templates: { name: 'Grocery Hamper' },
};

describe('VendorAlertsService', () => {
  let sut: VendorAlertsService;
  let repo: Record<string, jest.Mock>;
  let email: { isConfigured: jest.Mock; send: jest.Mock };
  const sentAt = (i: number) =>
    (email.send.mock.calls as [{ to: string; text: string }][])[i][0];
  let env: Record<string, string | undefined>;

  beforeEach(async () => {
    repo = {
      vendorContact: jest.fn().mockResolvedValue(vendor),
      order: jest.fn().mockResolvedValue(order),
      claim: jest.fn().mockResolvedValue('notification-1'),
      markSent: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      unacknowledgedDeliveries: jest.fn().mockResolvedValue([]),
      unconfirmedPickups: jest.fn().mockResolvedValue([]),
    };
    email = {
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue('resend-1'),
    };
    env = { OPS_ALERT_EMAIL: 'ops@ebun.com.ng' };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VendorAlertsService,
        { provide: VendorAlertsRepository, useValue: repo },
        { provide: EmailSenderService, useValue: email },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();
    sut = moduleRef.get(VendorAlertsService);
  });

  it('emails the vendor everything needed to deliver — but never their private link', async () => {
    await sut.newDelivery('order-1', 'vendor-1');

    expect(repo.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'vendor',
        email: 'orders@hamperhouse.ng',
        idempotencyKey: 'vendor-delivery:order-1:vendor-1',
      }),
    );
    const sent = sentAt(0);
    expect(sent.to).toBe('orders@hamperhouse.ng');
    expect(sent.text).toContain('12 Admiralty Way, Lekki');
    expect(sent.text).toContain('+2348012345678');
    expect(sent.text).toContain('Blue gate');
    expect(sent.text).not.toMatch(/\/vendor\//);
    expect(repo.markSent).toHaveBeenCalledWith('notification-1', 'resend-1');
  });

  it('sends nothing twice: a claimed alert is skipped', async () => {
    repo.claim.mockResolvedValue(null);

    await sut.newDelivery('order-1', 'vendor-1');

    expect(email.send).not.toHaveBeenCalled();
  });

  it('records a failed send and never throws to the caller', async () => {
    email.send.mockRejectedValue(new Error('Resend 403: domain not verified'));

    await expect(
      sut.newPickup('order-1', 'vendor-1', '2026-10-14T12:00:00.000Z'),
    ).resolves.toBeUndefined();
    expect(repo.markFailed).toHaveBeenCalledWith(
      'notification-1',
      'Resend 403: domain not verified',
    );
  });

  it('does nothing when email is not set up, or the vendor has no email', async () => {
    email.isConfigured.mockReturnValue(false);
    await sut.newDelivery('order-1', 'vendor-1');
    email.isConfigured.mockReturnValue(true);
    repo.vendorContact.mockResolvedValue({ ...vendor, email: null });
    await sut.newDelivery('order-1', 'vendor-1');

    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('escalates a quiet vendor: reminder to them, and ops gets both their numbers', async () => {
    repo.unacknowledgedDeliveries.mockResolvedValue([
      {
        order_id: 'order-1',
        vendor_id: 'vendor-1',
        vendor_notified_at: new Date(Date.now() - 45 * 60_000).toISOString(),
        orders: {
          order_number: 'EBN-0042',
          status: OrderStatus.FulfillmentInProgress,
          delivery_zone: 'Lekki',
          gift_templates: { name: 'Grocery Hamper' },
        },
        vendors: vendor,
      },
    ]);

    const result = await sut.escalateOverdue();

    expect(result).toEqual({ deliveries: 1, pickups: 0 });
    const recipients = [sentAt(0).to, sentAt(1).to];
    expect(recipients).toEqual(['orders@hamperhouse.ng', 'ops@ebun.com.ng']);
    const opsText = sentAt(1).text;
    expect(opsText).toContain('+2348030000000');
    expect(opsText).toContain('+2348050000000');
  });
});
