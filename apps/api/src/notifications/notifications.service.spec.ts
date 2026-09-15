import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@ebun/types';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { TermiiWhatsappClientService } from '../termii/termii-whatsapp-client.service';

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    status: OrderStatus.VoucherIssued,
    order_number: 'EBN-0001',
    total_amount: 500000,
    gift_template_id: 'template-1',
    gift_value: 500000,
    recipient_name: 'Ada',
    recipient_phone: '+2348012345678',
    reveal_token: 'reveal-token-1',
    sender_id: 'sender-1',
    sender_message: null,
    message_type: null,
    message_url: null,
    message_duration_secs: null,
    reveal_theme: 'gold',
    scheduled_send_at: null,
    expires_at: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let sut: NotificationsService;
  let repository: {
    createPending: jest.Mock;
    markSent: jest.Mock;
    markFailed: jest.Mock;
  };
  let ordersService: { recordRevealSent: jest.Mock };
  let termii: { sendTemplateMessage: jest.Mock };

  beforeEach(async () => {
    repository = {
      createPending: jest.fn(),
      markSent: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    ordersService = {
      recordRevealSent: jest.fn().mockResolvedValue(undefined),
    };
    termii = { sendTemplateMessage: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repository },
        { provide: OrdersService, useValue: ordersService },
        { provide: TermiiWhatsappClientService, useValue: termii },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'https://app.ebun.ng',
            get: () => 'template-abc',
          },
        },
      ],
    }).compile();

    sut = moduleRef.get(NotificationsService);
  });

  it('builds the reveal URL from WEB_APP_BASE_URL + reveal_token and sends it', async () => {
    repository.createPending.mockResolvedValue({ id: 'notif-1' });
    termii.sendTemplateMessage.mockResolvedValue({
      providerMessageId: 'msg-1',
    });

    await sut.sendGiftRevealLink(makeOrder());

    expect(termii.sendTemplateMessage).toHaveBeenCalledWith({
      phoneNumber: '+2348012345678',
      data: { '1': 'Ada', '2': 'https://app.ebun.ng/reveal/reveal-token-1' },
    });
    expect(ordersService.recordRevealSent).toHaveBeenCalledWith(
      'order-1',
      'https://app.ebun.ng/reveal/reveal-token-1',
    );
    expect(repository.markSent).toHaveBeenCalledWith('notif-1', 'msg-1');
  });

  it('skips sending (and touches nothing else) when scheduled_send_at is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();

    await sut.sendGiftRevealLink(makeOrder({ scheduled_send_at: future }));

    expect(repository.createPending).not.toHaveBeenCalled();
    expect(termii.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('sends immediately when scheduled_send_at is in the past', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    repository.createPending.mockResolvedValue({ id: 'notif-1' });
    termii.sendTemplateMessage.mockResolvedValue({
      providerMessageId: 'msg-1',
    });

    await sut.sendGiftRevealLink(makeOrder({ scheduled_send_at: past }));

    expect(termii.sendTemplateMessage).toHaveBeenCalled();
  });

  it('does not call Termii again if a notification with this idempotency key already exists', async () => {
    repository.createPending.mockResolvedValue('ALREADY_SENT');

    await sut.sendGiftRevealLink(makeOrder());

    expect(termii.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('records the failure and does NOT throw when the Termii call fails — order fulfillment already succeeded by this point', async () => {
    repository.createPending.mockResolvedValue({ id: 'notif-1' });
    termii.sendTemplateMessage.mockRejectedValue(new Error('Termii is down'));

    await expect(sut.sendGiftRevealLink(makeOrder())).resolves.toBeUndefined();

    expect(repository.markFailed).toHaveBeenCalledWith(
      'notif-1',
      'Termii is down',
    );
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(ordersService.recordRevealSent).not.toHaveBeenCalled();
  });

  it('uses a per-order idempotency key so retries cannot double-send', async () => {
    repository.createPending.mockResolvedValue({ id: 'notif-1' });
    termii.sendTemplateMessage.mockResolvedValue({
      providerMessageId: 'msg-1',
    });

    await sut.sendGiftRevealLink(makeOrder());

    expect(repository.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        idempotencyKey: 'gift_reveal_link:order-1',
      }),
    );
  });
});
