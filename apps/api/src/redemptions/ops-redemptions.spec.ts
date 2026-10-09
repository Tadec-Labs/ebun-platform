import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrderStatus, RedemptionStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { StaffGuard } from '../auth/staff.guard';
import { UsersService } from '../users/users.service';
import { OpsRedemptionsController } from './ops-redemptions.controller';
import { RedemptionsService } from './redemptions.service';
import { RedemptionsRepository } from './redemptions.repository';
import { OrdersService } from '../orders/orders.service';
import { RedemptionConflictException } from './exceptions/redemption-conflict.exception';
import { RedemptionNotRedeemableException } from './exceptions/redemption-not-redeemable.exception';

const CODE = 'EBN-4M8K2L';
const VENDOR_ID = '3f2b1a40-5c8e-4d61-9a7b-1c2d3e4f5a6b';
const TOKEN = '9c1f4688-008c-4113-9a7b-1c2d3e4f5a6b';

const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + 24 * HOUR).toISOString();
const past = () => new Date(Date.now() - HOUR).toISOString();

const lookupRow = (over: Record<string, unknown> = {}) => ({
  id: 'redemption-1',
  order_id: 'order-1',
  redemption_number: 'RDM-0001',
  redemption_token: TOKEN,
  fallback_code: CODE,
  status: RedemptionStatus.Pending,
  expires_at: future(),
  completed_at: null,
  orders: {
    id: 'order-1',
    order_number: 'EBN-0014',
    recipient_name: 'John',
    status: OrderStatus.RevealOpened,
    gift_templates: { name: 'A Pizza, On Him' },
  },
  ...over,
});

describe('RedemptionsService — collection by fallback code', () => {
  let sut: RedemptionsService;
  let repository: Record<string, jest.Mock>;
  let ordersService: { transitionNormal: jest.Mock };

  beforeEach(async () => {
    repository = {
      findByFallbackCode: jest.fn(),
      attemptRedemption: jest.fn(),
      createPendingOrFetch: jest.fn(),
      findByOrderId: jest.fn(),
    };
    ordersService = {
      transitionNormal: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedemptionsService,
        { provide: RedemptionsRepository, useValue: repository },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    sut = moduleRef.get(RedemptionsService);
  });

  describe('lookupByFallbackCode', () => {
    it('describes a collectable gift without ever exposing the redemption token', async () => {
      repository.findByFallbackCode.mockResolvedValue(lookupRow());

      const view = await sut.lookupByFallbackCode(CODE);

      expect(view).toMatchObject({
        code: CODE,
        redemptionNumber: 'RDM-0001',
        orderNumber: 'EBN-0014',
        recipientName: 'John',
        giftName: 'A Pizza, On Him',
        redeemable: true,
        blockedReason: null,
      });
      // The token is what completes a redemption. A lookup any staff
      // member can run against any code must never hand it out.
      expect(JSON.stringify(view)).not.toContain(TOKEN);
    });

    it('404s on an unknown code', async () => {
      repository.findByFallbackCode.mockResolvedValue(null);
      await expect(sut.lookupByFallbackCode(CODE)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('refuses a gift that was already collected, and says so', async () => {
      repository.findByFallbackCode.mockResolvedValue(
        lookupRow({
          status: RedemptionStatus.Completed,
          completed_at: past(),
        }),
      );

      const view = await sut.lookupByFallbackCode(CODE);

      expect(view.redeemable).toBe(false);
      expect(view.blockedReason).toMatch(/already been collected/i);
    });

    it('refuses an expired code even while its status still reads pending', async () => {
      // Nothing sweeps redemptions to 'expired' on a schedule, so the
      // timestamp is the only trustworthy source here.
      repository.findByFallbackCode.mockResolvedValue(
        lookupRow({ status: RedemptionStatus.Pending, expires_at: past() }),
      );

      const view = await sut.lookupByFallbackCode(CODE);

      expect(view.redeemable).toBe(false);
      expect(view.blockedReason).toMatch(/expired/i);
    });

    it('refuses a failed or expired redemption status', async () => {
      for (const status of [
        RedemptionStatus.Failed,
        RedemptionStatus.Expired,
      ]) {
        repository.findByFallbackCode.mockResolvedValue(lookupRow({ status }));
        const view = await sut.lookupByFallbackCode(CODE);
        expect(view.redeemable).toBe(false);
        expect(view.blockedReason).toMatch(/no longer valid/i);
      }
    });

    it("refuses when the recipient hasn't claimed the gift yet", async () => {
      repository.findByFallbackCode.mockResolvedValue(
        lookupRow({
          orders: {
            id: 'order-1',
            order_number: 'EBN-0014',
            recipient_name: 'John',
            status: OrderStatus.VoucherIssued,
            gift_templates: { name: 'A Pizza, On Him' },
          },
        }),
      );

      const view = await sut.lookupByFallbackCode(CODE);

      expect(view.redeemable).toBe(false);
      expect(view.blockedReason).toMatch(/hasn't opened and claimed/i);
    });
  });

  describe('completeByFallbackCode', () => {
    const completeParams = {
      code: CODE,
      vendorId: VENDOR_ID,
      confirmedBy: 'Theo (Ebun ops)',
      actorId: 'staff-1',
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    };

    it('looks the token up server-side and completes with it', async () => {
      repository.findByFallbackCode.mockResolvedValue(lookupRow());
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        redemption_number: 'RDM-0001',
        status: RedemptionStatus.Completed,
      });

      const result = await sut.completeByFallbackCode(completeParams);

      expect(repository.attemptRedemption).toHaveBeenCalledWith({
        redemptionToken: TOKEN,
        vendorId: VENDOR_ID,
        vendorConfirmedBy: 'Theo (Ebun ops)',
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      });
      expect(result.orderId).toBe('order-1');
      expect(result.redemption.status).toBe(RedemptionStatus.Completed);
    });

    it("records the order transition as 'admin', not as a vendor scan", async () => {
      repository.findByFallbackCode.mockResolvedValue(lookupRow());
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: RedemptionStatus.Completed,
      });

      await sut.completeByFallbackCode(completeParams);

      expect(ordersService.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
        { type: 'admin' },
      );
    });

    it('refuses before touching the RPC when the gift cannot be collected', async () => {
      repository.findByFallbackCode.mockResolvedValue(
        lookupRow({ status: RedemptionStatus.Completed }),
      );

      await expect(sut.completeByFallbackCode(completeParams)).rejects.toThrow(
        RedemptionNotRedeemableException,
      );
      expect(repository.attemptRedemption).not.toHaveBeenCalled();
    });

    it('surfaces a lost race as a conflict rather than a silent success', async () => {
      repository.findByFallbackCode.mockResolvedValue(lookupRow());
      repository.attemptRedemption.mockResolvedValue(null);

      await expect(sut.completeByFallbackCode(completeParams)).rejects.toThrow(
        RedemptionConflictException,
      );
    });

    it('404s on an unknown code', async () => {
      repository.findByFallbackCode.mockResolvedValue(null);
      await expect(
        sut.completeByFallbackCode(completeParams),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});

/**
 * Real HTTP, real StaffGuard, real ValidationPipe — only the service
 * behind them is mocked. Proves the routes are actually protected and
 * that a malformed code never reaches the database.
 */
describe('ops redemption routes over HTTP', () => {
  let app: INestApplication<App>;
  let redemptions: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };
  let auth: { verifyAccessToken: jest.Mock };
  let users: { findStaffByAuthId: jest.Mock };

  const asRole = (role: string, isActive = true) => {
    auth.verifyAccessToken.mockResolvedValue({
      authId: 'auth-1',
      email: 'theo@ebun.ng',
    });
    users.findStaffByAuthId.mockResolvedValue({
      id: 'staff-1',
      auth_id: 'auth-1',
      email: 'theo@ebun.ng',
      name: 'Theo',
      role,
      is_active: isActive,
    });
  };

  beforeEach(async () => {
    redemptions = {
      lookupByFallbackCode: jest.fn().mockResolvedValue({ code: CODE }),
      completeByFallbackCode: jest.fn().mockResolvedValue({
        redemption: {
          id: 'redemption-1',
          redemption_number: 'RDM-0001',
          status: RedemptionStatus.Completed,
        },
        orderId: 'order-1',
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    auth = { verifyAccessToken: jest.fn() };
    users = { findStaffByAuthId: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [OpsRedemptionsController],
      providers: [
        StaffGuard,
        { provide: RedemptionsService, useValue: redemptions },
        { provide: AuditService, useValue: audit },
        { provide: AuthService, useValue: auth },
        { provide: UsersService, useValue: users },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401s both routes without a token, calling no service', async () => {
    const server = app.getHttpServer();
    await request(server).get(`/ops/redemptions/${CODE}`).expect(401);
    await request(server)
      .post(`/ops/redemptions/${CODE}/complete`)
      .send({ vendorId: VENDOR_ID })
      .expect(401);

    expect(redemptions.lookupByFallbackCode).not.toHaveBeenCalled();
    expect(redemptions.completeByFallbackCode).not.toHaveBeenCalled();
  });

  it('403s a staff role that may not complete redemptions', async () => {
    for (const role of ['ebun_support', 'ebun_finance', 'sender', 'vendor']) {
      asRole(role);
      await request(app.getHttpServer())
        .post(`/ops/redemptions/${CODE}/complete`)
        .set('Authorization', 'Bearer good')
        .send({ vendorId: VENDOR_ID })
        .expect(403);
    }
    expect(redemptions.completeByFallbackCode).not.toHaveBeenCalled();
  });

  it('403s a deactivated admin', async () => {
    asRole('ebun_admin', false);
    await request(app.getHttpServer())
      .get(`/ops/redemptions/${CODE}`)
      .set('Authorization', 'Bearer good')
      .expect(403);
    expect(redemptions.lookupByFallbackCode).not.toHaveBeenCalled();
  });

  it('rejects a malformed code before it reaches the service', async () => {
    asRole('ebun_ops');
    for (const bad of ['nonsense', 'EBN-4M8K2', 'EBN-4M8K2O', '%20']) {
      await request(app.getHttpServer())
        .get(`/ops/redemptions/${encodeURIComponent(bad)}`)
        .set('Authorization', 'Bearer good')
        .expect(400);
    }
    expect(redemptions.lookupByFallbackCode).not.toHaveBeenCalled();
  });

  it('normalises a sloppily-typed code before looking it up', async () => {
    asRole('ebun_ops');
    await request(app.getHttpServer())
      .get('/ops/redemptions/ebn4m8k2l')
      .set('Authorization', 'Bearer good')
      .expect(200);

    expect(redemptions.lookupByFallbackCode).toHaveBeenCalledWith(CODE);
  });

  it('requires a real vendor uuid to complete', async () => {
    asRole('ebun_ops');
    for (const body of [{}, { vendorId: '' }, { vendorId: 'not-a-uuid' }]) {
      await request(app.getHttpServer())
        .post(`/ops/redemptions/${CODE}/complete`)
        .set('Authorization', 'Bearer good')
        .send(body)
        .expect(400);
    }
    expect(redemptions.completeByFallbackCode).not.toHaveBeenCalled();
  });

  it('completes, names the confirming staff member, and audits it', async () => {
    asRole('ebun_admin');

    const response = await request(app.getHttpServer())
      .post(`/ops/redemptions/${CODE}/complete`)
      .set('Authorization', 'Bearer good')
      .send({ vendorId: VENDOR_ID })
      .expect(201);

    expect(response.body).toEqual({
      redemptionNumber: 'RDM-0001',
      status: RedemptionStatus.Completed,
    });
    expect(redemptions.completeByFallbackCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CODE,
        vendorId: VENDOR_ID,
        confirmedBy: 'Theo (Ebun ops)',
        actorId: 'staff-1',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REDEMPTION_COMPLETED',
        actorType: 'admin',
        resourceType: 'redemption',
        resourceId: 'redemption-1',
        metadata: expect.objectContaining({
          vendorId: VENDOR_ID,
          confirmedVia: 'ops_manual_code_entry',
        }) as unknown,
      }),
    );
  });

  it('strips unknown body fields rather than passing them through', async () => {
    asRole('ebun_admin');
    await request(app.getHttpServer())
      .post(`/ops/redemptions/${CODE}/complete`)
      .set('Authorization', 'Bearer good')
      .send({ vendorId: VENDOR_ID, status: 'completed', notes: 'free gift' })
      .expect(201);

    const call = (
      redemptions.completeByFallbackCode.mock.calls as unknown[][]
    )[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('status');
    expect(call).not.toHaveProperty('notes');
  });

  it('never caches a redemption response', async () => {
    asRole('ebun_ops');
    const response = await request(app.getHttpServer())
      .get(`/ops/redemptions/${CODE}`)
      .set('Authorization', 'Bearer good')
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
