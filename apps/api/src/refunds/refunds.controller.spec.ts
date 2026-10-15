import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { StaffGuard } from '../auth/staff.guard';
import { UsersService } from '../users/users.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

const ORDER = '3f2b1a40-5c8e-4d61-9a7b-1c2d3e4f5a6b';

/** Real HTTP, real StaffGuard and ValidationPipe — the service is mocked. */
describe('refund routes over HTTP', () => {
  let app: INestApplication<App>;
  let refunds: { forOrder: jest.Mock; refund: jest.Mock };
  let auth: { verifyAccessToken: jest.Mock };
  let users: { findStaffByAuthId: jest.Mock };

  const asRole = (role: string) => {
    auth.verifyAccessToken.mockResolvedValue({
      authId: 'auth-1',
      email: 'x@y.z',
    });
    users.findStaffByAuthId.mockResolvedValue({
      id: 'staff-1',
      auth_id: 'auth-1',
      email: 'x@y.z',
      name: 'Staffer',
      role,
      is_active: true,
    });
  };

  beforeEach(async () => {
    refunds = {
      forOrder: jest.fn().mockResolvedValue({ refunds: [] }),
      refund: jest.fn().mockResolvedValue({ refunds: [] }),
    };
    auth = { verifyAccessToken: jest.fn() };
    users = { findStaffByAuthId: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [
        StaffGuard,
        { provide: RefundsService, useValue: refunds },
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

  const valid = { reasonCategory: 'vendor_failure', reason: 'Shop closed' };

  it('401s without a token and 403s support staff, refunding nothing', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post(`/ops/orders/${ORDER}/refunds`)
      .send(valid)
      .expect(401);

    asRole('ebun_support');
    await request(server)
      .post(`/ops/orders/${ORDER}/refunds`)
      .set('Authorization', 'Bearer ok')
      .send(valid)
      .expect(403);
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('refunds as the staff member, never an amount from the client', async () => {
    asRole('ebun_finance');
    const res = await request(app.getHttpServer())
      .post(`/ops/orders/${ORDER}/refunds`)
      .set('Authorization', 'Bearer ok')
      .send({ ...valid, amount: 1 })
      .expect(201);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(refunds.refund).toHaveBeenCalledWith(
      ORDER,
      {
        reasonCategory: 'vendor_failure',
        reason: 'Shop closed',
        alreadyRefundedInPaystack: false,
      },
      expect.objectContaining({ userId: 'staff-1' }),
      expect.anything(),
    );
  });

  it('400s a missing reason or an unknown category', async () => {
    asRole('ebun_admin');
    const server = app.getHttpServer();
    for (const body of [
      { reasonCategory: 'vendor_failure' },
      { reasonCategory: 'because', reason: 'Shop closed' },
      { reasonCategory: 'other', reason: '  ' },
    ]) {
      await request(server)
        .post(`/ops/orders/${ORDER}/refunds`)
        .set('Authorization', 'Bearer ok')
        .send(body)
        .expect(400);
    }
    expect(refunds.refund).not.toHaveBeenCalled();
  });
});
