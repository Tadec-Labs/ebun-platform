import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationStatus } from '@ebun/types';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { OrdersService } from '../orders/orders.service';
import { TermiiWhatsappClientService } from '../termii/termii-whatsapp-client.service';

const retryable = (over: Record<string, unknown> = {}) => ({
  id: 'notif-1',
  order_id: 'order-1',
  status: NotificationStatus.Failed,
  idempotency_key: 'gift_reveal_link:order-1',
  recipient_phone: '+2348012345678',
  payload: {
    data: { '1': 'John', '2': 'https://app.ebun.ng/reveal/tok' },
    revealUrl: 'https://app.ebun.ng/reveal/tok',
  },
  retry_count: 0,
  max_retries: 3,
  ...over,
});

describe('NotificationsService.retryFailedSends', () => {
  let sut: NotificationsService;
  let repository: Record<string, jest.Mock>;
  let termii: { sendTemplateMessage: jest.Mock };
  let orders: Record<string, jest.Mock>;

  beforeEach(async () => {
    repository = {
      findRetryable: jest.fn().mockResolvedValue([]),
      markSent: jest.fn().mockResolvedValue(undefined),
      scheduleRetry: jest.fn().mockResolvedValue(undefined),
      markExhausted: jest.fn().mockResolvedValue(undefined),
    };
    termii = {
      sendTemplateMessage: jest
        .fn()
        .mockResolvedValue({ providerMessageId: 'tm-1' }),
    };
    orders = { recordRevealSent: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repository },
        { provide: TermiiWhatsappClientService, useValue: termii },
        { provide: OrdersService, useValue: orders },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
      ],
    }).compile();

    sut = moduleRef.get(NotificationsService);
  });

  it('re-sends the stored payload, not a freshly rebuilt message', async () => {
    // A retry that quietly composes a different message is not a retry.
    repository.findRetryable.mockResolvedValue([retryable()]);

    await sut.retryFailedSends();

    expect(termii.sendTemplateMessage).toHaveBeenCalledWith({
      phoneNumber: '+2348012345678',
      data: { '1': 'John', '2': 'https://app.ebun.ng/reveal/tok' },
    });
  });

  it('marks the notification sent and records the link on the order', async () => {
    repository.findRetryable.mockResolvedValue([retryable()]);

    const result = await sut.retryFailedSends();

    expect(repository.markSent).toHaveBeenCalledWith('notif-1', 'tm-1');
    // recordRevealSent is what stops the scheduled-send sweep picking
    // this order up again.
    expect(orders.recordRevealSent).toHaveBeenCalledWith(
      'order-1',
      'https://app.ebun.ng/reveal/tok',
    );
    expect(result).toEqual({
      attempted: 1,
      sent: 1,
      rescheduled: 0,
      exhausted: 0,
    });
  });

  it('schedules the next attempt with growing backoff when a send fails', async () => {
    repository.findRetryable.mockResolvedValue([retryable({ retry_count: 0 })]);
    termii.sendTemplateMessage.mockRejectedValue(new Error('provider 503'));
    const before = Date.now();

    const result = await sut.retryFailedSends();

    expect(repository.scheduleRetry).toHaveBeenCalled();
    const [id, attempt, nextAt, message] = (
      repository.scheduleRetry.mock.calls as unknown[][]
    )[0] as [string, number, Date, string];
    expect(id).toBe('notif-1');
    expect(attempt).toBe(1);
    expect(nextAt.getTime()).toBeGreaterThan(before);
    expect(message).toContain('provider 503');
    expect(result.rescheduled).toBe(1);
  });

  it('backs off further on each successive attempt', async () => {
    repository.findRetryable.mockResolvedValue([retryable({ retry_count: 1 })]);
    termii.sendTemplateMessage.mockRejectedValue(new Error('still down'));

    await sut.retryFailedSends();

    const [, , secondAttemptAt] = (
      repository.scheduleRetry.mock.calls as unknown[][]
    )[0] as [string, number, Date, string];
    // Second attempt waits materially longer than the first (~25 min vs ~5).
    expect(secondAttemptAt.getTime() - Date.now()).toBeGreaterThan(20 * 60_000);
  });

  it('gives up loudly on the final attempt instead of retrying forever', async () => {
    repository.findRetryable.mockResolvedValue([
      retryable({ retry_count: 2, max_retries: 3 }),
    ]);
    termii.sendTemplateMessage.mockRejectedValue(new Error('gone'));

    const result = await sut.retryFailedSends();

    expect(repository.markExhausted).toHaveBeenCalledWith('notif-1', 3, 'gone');
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(result.exhausted).toBe(1);
  });

  it('gives up immediately on a row it could never re-send', async () => {
    repository.findRetryable.mockResolvedValue([
      retryable({ payload: null }),
      retryable({ id: 'notif-2', recipient_phone: null }),
    ]);

    const result = await sut.retryFailedSends();

    expect(termii.sendTemplateMessage).not.toHaveBeenCalled();
    expect(repository.markExhausted).toHaveBeenCalledTimes(2);
    expect(result.exhausted).toBe(2);
  });

  it('does not touch the order when a retry has no reveal url to record', async () => {
    repository.findRetryable.mockResolvedValue([
      retryable({ payload: { data: { '1': 'John' } } }),
    ]);

    await sut.retryFailedSends();

    expect(repository.markSent).toHaveBeenCalled();
    expect(orders.recordRevealSent).not.toHaveBeenCalled();
  });

  it('keeps processing the batch after one row fails', async () => {
    repository.findRetryable.mockResolvedValue([
      retryable({ id: 'a' }),
      retryable({ id: 'b' }),
      retryable({ id: 'c' }),
    ]);
    termii.sendTemplateMessage
      .mockResolvedValueOnce({ providerMessageId: 'tm-a' })
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ providerMessageId: 'tm-c' });

    const result = await sut.retryFailedSends();

    expect(result).toEqual({
      attempted: 3,
      sent: 2,
      rescheduled: 1,
      exhausted: 0,
    });
  });

  it('does nothing when nothing is due', async () => {
    const result = await sut.retryFailedSends();
    expect(termii.sendTemplateMessage).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });
});
