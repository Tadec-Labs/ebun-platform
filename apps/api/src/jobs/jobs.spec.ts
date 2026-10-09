import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { OrderStatus } from '@ebun/types';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { ExpiryJob } from './expiry.job';
import { NotificationRetryJob } from './notification-retry.job';
import { ScheduledSendJob } from './scheduled-send.job';
import { StuckOrderJob } from './stuck-order.job';
import { JobsModule } from './jobs.module';
import { backgroundJobsEnabled } from './jobs.config';

const order = (over: Record<string, unknown> = {}) => ({
  id: 'order-1',
  order_number: 'EBN-0014',
  status: OrderStatus.VoucherIssued,
  expires_at: new Date(Date.now() - 1000).toISOString(),
  ...over,
});

const configOf = (value?: string) =>
  ({ get: jest.fn().mockReturnValue(value) }) as unknown as ConfigService;

describe('backgroundJobsEnabled', () => {
  it('defaults to enabled when unset, so a deployment needs no new config', () => {
    expect(backgroundJobsEnabled(undefined)).toBe(true);
    expect(backgroundJobsEnabled('')).toBe(true);
  });

  it('is disabled only by an explicit false', () => {
    expect(backgroundJobsEnabled('false')).toBe(false);
    expect(backgroundJobsEnabled('FALSE')).toBe(false);
    expect(backgroundJobsEnabled(' false ')).toBe(false);
    expect(backgroundJobsEnabled('true')).toBe(true);
    // Anything unrecognised stays enabled rather than silently
    // switching the safety net off.
    expect(backgroundJobsEnabled('no')).toBe(true);
  });
});

describe('ScheduledSendJob', () => {
  let sut: ScheduledSendJob;
  let orders: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;

  const build = async (config = configOf()) => {
    orders = { findScheduledSendsDue: jest.fn().mockResolvedValue([]) };
    notifications = {
      sendGiftRevealLink: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScheduledSendJob,
        { provide: OrdersService, useValue: orders },
        { provide: NotificationsService, useValue: notifications },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    sut = moduleRef.get(ScheduledSendJob);
  };

  it('sends every gift whose scheduled time has arrived', async () => {
    await build();
    orders.findScheduledSendsDue.mockResolvedValue([
      order({ id: 'a' }),
      order({ id: 'b' }),
    ]);

    const result = await sut.dispatchDue();

    expect(notifications.sendGiftRevealLink).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ due: 2, failures: 0 });
  });

  it('keeps going when one gift fails to send', async () => {
    await build();
    orders.findScheduledSendsDue.mockResolvedValue([
      order({ id: 'a' }),
      order({ id: 'b' }),
      order({ id: 'c' }),
    ]);
    notifications.sendGiftRevealLink
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('termii down'))
      .mockResolvedValueOnce(undefined);

    const result = await sut.dispatchDue();

    expect(notifications.sendGiftRevealLink).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ due: 3, failures: 1 });
  });

  it('does nothing when nothing is due', async () => {
    await build();
    const result = await sut.dispatchDue();
    expect(notifications.sendGiftRevealLink).not.toHaveBeenCalled();
    expect(result).toEqual({ due: 0, failures: 0 });
  });

  it('does not run at all when background jobs are switched off', async () => {
    await build(configOf('false'));
    await sut.run();
    expect(orders.findScheduledSendsDue).not.toHaveBeenCalled();
  });
});

describe('ExpiryJob', () => {
  let sut: ExpiryJob;
  let orders: Record<string, jest.Mock>;
  let redemptions: Record<string, jest.Mock>;

  const build = async (config = configOf()) => {
    orders = {
      findExpirable: jest.fn().mockResolvedValue([]),
      transitionNormal: jest.fn().mockResolvedValue(undefined),
    };
    redemptions = { expireOverdue: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExpiryJob,
        { provide: OrdersService, useValue: orders },
        { provide: RedemptionsService, useValue: redemptions },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    sut = moduleRef.get(ExpiryJob);
  };

  it('expires each order through the state machine, not a batch update', async () => {
    // Going through transitionNormal is the whole point: it is what
    // writes the audit row that expire_unclaimed_gifts() skips.
    await build();
    orders.findExpirable.mockResolvedValue([
      order({ id: 'a', status: OrderStatus.VoucherIssued }),
      order({ id: 'b', status: OrderStatus.RevealOpened }),
    ]);

    const result = await sut.expireOverdue();

    expect(orders.transitionNormal).toHaveBeenCalledWith(
      'a',
      OrderStatus.VoucherIssued,
      OrderStatus.Expired,
      { type: 'cron' },
      expect.objectContaining({ expiredAt: expect.any(String) as unknown }),
    );
    expect(orders.transitionNormal).toHaveBeenCalledWith(
      'b',
      OrderStatus.RevealOpened,
      OrderStatus.Expired,
      { type: 'cron' },
      expect.anything(),
    );
    expect(result.orders).toBe(2);
  });

  it('expires each order from its OWN current status, never a hardcoded one', async () => {
    await build();
    orders.findExpirable.mockResolvedValue([
      order({ id: 'a', status: OrderStatus.ReadyForRedemption }),
    ]);

    await sut.expireOverdue();

    const call = (orders.transitionNormal.mock.calls as unknown[][])[0];
    expect(call[1]).toBe(OrderStatus.ReadyForRedemption);
  });

  it('treats a lost race as normal and carries on with the batch', async () => {
    await build();
    orders.findExpirable.mockResolvedValue([
      order({ id: 'a' }),
      order({ id: 'b' }),
    ]);
    orders.transitionNormal
      .mockRejectedValueOnce(
        new OrderTransitionConflictException(
          'a',
          OrderStatus.VoucherIssued,
          OrderStatus.Expired,
        ),
      )
      .mockResolvedValueOnce(undefined);

    const result = await sut.expireOverdue();

    expect(result.orders).toBe(1);
  });

  it('keeps going when one order cannot be expired for an unexpected reason', async () => {
    await build();
    orders.findExpirable.mockResolvedValue([
      order({ id: 'a' }),
      order({ id: 'b' }),
    ]);
    orders.transitionNormal
      .mockRejectedValueOnce(new Error('database on fire'))
      .mockResolvedValueOnce(undefined);

    const result = await sut.expireOverdue();

    expect(result.orders).toBe(1);
    expect(redemptions.expireOverdue).toHaveBeenCalled();
  });

  it('expires overdue redemptions too', async () => {
    await build();
    redemptions.expireOverdue.mockResolvedValue(['r1', 'r2']);

    const result = await sut.expireOverdue();

    expect(result.redemptions).toBe(2);
  });

  it('does not run at all when background jobs are switched off', async () => {
    await build(configOf('false'));
    await sut.run();
    expect(orders.findExpirable).not.toHaveBeenCalled();
  });
});

describe('StuckOrderJob', () => {
  let sut: StuckOrderJob;
  let orders: Record<string, jest.Mock>;

  const build = async (config = configOf()) => {
    orders = { findStuckInFulfillment: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        StuckOrderJob,
        { provide: OrdersService, useValue: orders },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    sut = moduleRef.get(StuckOrderJob);
  };

  it('reports stuck orders without changing any of them', async () => {
    // Auto-transitioning would destroy the state a human needs to
    // choose between re-running fulfilment and refunding.
    await build();
    orders.findStuckInFulfillment.mockResolvedValue([
      order({ id: 'a', status: OrderStatus.Processing }),
      order({ id: 'b', status: OrderStatus.FulfillmentInProgress }),
    ]);

    const result = await sut.detect();

    expect(result).toEqual({ stuck: 2, orderIds: ['a', 'b'] });
    // The only dependency it has is a read.
    expect(Object.keys(orders)).toEqual(['findStuckInFulfillment']);
  });

  it('looks back from a cutoff in the past, not from now', async () => {
    await build();
    const before = Date.now();

    await sut.detect();

    const cutoff = (
      orders.findStuckInFulfillment.mock.calls as unknown[][]
    )[0][0] as Date;
    expect(cutoff.getTime()).toBeLessThan(before);
  });

  it('is quiet when nothing is stuck', async () => {
    await build();
    const result = await sut.detect();
    expect(result).toEqual({ stuck: 0, orderIds: [] });
  });

  it('does not run at all when background jobs are switched off', async () => {
    await build(configOf('false'));
    await sut.run();
    expect(orders.findStuckInFulfillment).not.toHaveBeenCalled();
  });
});

describe('NotificationRetryJob', () => {
  let sut: NotificationRetryJob;
  let notifications: Record<string, jest.Mock>;

  const build = async (config = configOf()) => {
    notifications = {
      retryFailedSends: jest.fn().mockResolvedValue({
        attempted: 0,
        sent: 0,
        rescheduled: 0,
        exhausted: 0,
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationRetryJob,
        { provide: NotificationsService, useValue: notifications },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    sut = moduleRef.get(NotificationRetryJob);
  };

  it('delegates to the service and returns its tally', async () => {
    await build();
    notifications.retryFailedSends.mockResolvedValue({
      attempted: 3,
      sent: 2,
      rescheduled: 1,
      exhausted: 0,
    });

    const result = await sut.retryDue();

    expect(result.sent).toBe(2);
  });

  it('does not run at all when background jobs are switched off', async () => {
    await build(configOf('false'));
    await sut.run();
    expect(notifications.retryFailedSends).not.toHaveBeenCalled();
  });
});

describe('cron registration (real ScheduleModule)', () => {
  /**
   * The failure this guards against is silent and total: without
   * ScheduleModule.forRoot() the @Cron decorators still compile, the
   * app still boots, and not one job ever fires. No unit test of a job's
   * body can catch that, so this boots the real scheduler and asks it
   * what it actually registered.
   */
  it('registers all four jobs on the real scheduler', async () => {
    const moduleRef = await Test.createTestingModule({
      // The same forRoot JobsModule itself declares — asserted below to
      // actually be in JobsModule's own imports, so this can't drift.
      imports: [ScheduleModule.forRoot()],
      providers: [
        ScheduledSendJob,
        ExpiryJob,
        StuckOrderJob,
        NotificationRetryJob,
        { provide: OrdersService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: RedemptionsService, useValue: {} },
        { provide: ConfigService, useValue: configOf('false') },
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = app.get(SchedulerRegistry);
    const registered = [...registry.getCronJobs().keys()].sort();

    expect(registered).toEqual([
      'detect-stuck-orders',
      'expire-unclaimed',
      'retry-notifications',
      'scheduled-send',
    ]);

    await app.close();
  });

  it('JobsModule brings its own scheduler, so importing it is enough', () => {
    // Guards the other half of the silent failure: correct decorators
    // with no ScheduleModule anywhere still means nothing ever runs.
    const imports = (Reflect.getMetadata('imports', JobsModule) ??
      []) as unknown[];

    const bringsScheduler = imports.some(
      (imported) =>
        imported === ScheduleModule ||
        (typeof imported === 'object' &&
          imported !== null &&
          (imported as { module?: unknown }).module === ScheduleModule),
    );

    expect(bringsScheduler).toBe(true);
  });
});
