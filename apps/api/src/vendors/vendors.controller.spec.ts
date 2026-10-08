import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { OpsSessionController } from '../auth/ops-session.controller';
import { StaffGuard } from '../auth/staff.guard';
import { UsersService } from '../users/users.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

/**
 * Real HTTP, real StaffGuard, real ValidationPipe — only the services
 * behind them are mocked. The point is proving the ROUTES are actually
 * protected and validated, not re-testing business logic.
 */
describe('ops routes over HTTP', () => {
  let app: INestApplication<App>;
  let vendorsService: Record<string, jest.Mock>;
  let auth: { verifyAccessToken: jest.Mock };
  let users: { findStaffByAuthId: jest.Mock };

  const asRole = (role: string, isActive = true) => {
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
      is_active: isActive,
    });
  };

  const VALID_BODY = {
    businessName: 'Mama Cass Kitchen',
    ownerName: 'Cassandra Okoye',
    whatsappNumber: '+2348012345678',
    category: 'food',
  };
  const UUID = '3f2b1a40-5c8e-4d61-9a7b-1c2d3e4f5a6b';

  beforeEach(async () => {
    vendorsService = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: UUID }),
      get: jest.fn().mockResolvedValue({ id: UUID }),
      update: jest.fn().mockResolvedValue({ id: UUID }),
      listOfferings: jest.fn().mockResolvedValue([]),
      upsertOffering: jest.fn().mockResolvedValue({}),
      removeOffering: jest.fn().mockResolvedValue(undefined),
    };
    auth = { verifyAccessToken: jest.fn() };
    users = { findStaffByAuthId: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [VendorsController, OpsSessionController],
      providers: [
        StaffGuard,
        { provide: VendorsService, useValue: vendorsService },
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

  describe('authentication & authorisation', () => {
    it('401s every vendor route without a token, calling no service', async () => {
      const server = app.getHttpServer();
      await request(server).get('/ops/vendors').expect(401);
      await request(server).post('/ops/vendors').send(VALID_BODY).expect(401);
      await request(server).get(`/ops/vendors/${UUID}`).expect(401);
      await request(server)
        .patch(`/ops/vendors/${UUID}`)
        .send({ notes: 'x' })
        .expect(401);
      await request(server).get(`/ops/vendors/${UUID}/offerings`).expect(401);
      await request(server)
        .put(`/ops/vendors/${UUID}/offerings/${UUID}`)
        .send({ vendorPrice: 1 })
        .expect(401);
      await request(server)
        .delete(`/ops/vendors/${UUID}/offerings/${UUID}`)
        .expect(401);

      for (const fn of Object.values(vendorsService)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it('401s when Supabase rejects the token', async () => {
      auth.verifyAccessToken.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get('/ops/vendors')
        .set('Authorization', 'Bearer forged')
        .expect(401);
      expect(vendorsService.list).not.toHaveBeenCalled();
    });

    it.each(['ebun_support', 'ebun_finance', 'sender', 'vendor'])(
      '403s role %s on vendor management',
      async (role) => {
        asRole(role);
        await request(app.getHttpServer())
          .get('/ops/vendors')
          .set('Authorization', 'Bearer ok')
          .expect(403);
        expect(vendorsService.list).not.toHaveBeenCalled();
      },
    );

    it('403s a deactivated admin', async () => {
      asRole('ebun_admin', false);
      await request(app.getHttpServer())
        .get('/ops/vendors')
        .set('Authorization', 'Bearer ok')
        .expect(403);
    });

    it.each(['ebun_admin', 'ebun_ops'])(
      'lets %s in, uncached',
      async (role) => {
        asRole(role);
        const res = await request(app.getHttpServer())
          .get('/ops/vendors')
          .set('Authorization', 'Bearer ok')
          .expect(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(vendorsService.list).toHaveBeenCalled();
      },
    );
  });

  describe('validation', () => {
    beforeEach(() => asRole('ebun_ops'));
    const authed = (req: request.Test) => req.set('Authorization', 'Bearer ok');

    it('creates with the staff identity attached', async () => {
      await authed(request(app.getHttpServer()).post('/ops/vendors'))
        .send(VALID_BODY)
        .expect(201);

      expect(vendorsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ businessName: 'Mama Cass Kitchen' }),
        expect.objectContaining({ userId: 'staff-1', role: 'ebun_ops' }),
        expect.objectContaining({ ipAddress: expect.anything() as unknown }),
      );
    });

    it('400s a bad phone number without calling the service', async () => {
      await authed(request(app.getHttpServer()).post('/ops/vendors'))
        .send({ ...VALID_BODY, whatsappNumber: '08012345678' })
        .expect(400);
      expect(vendorsService.create).not.toHaveBeenCalled();
    });

    it('strips unknown fields rather than passing them through (no mass assignment)', async () => {
      await authed(request(app.getHttpServer()).post('/ops/vendors'))
        .send({ ...VALID_BODY, rating: 5, totalOrders: 9999, id: 'forced' })
        .expect(201);
      const calls = vendorsService.create.mock.calls as unknown[][];
      const dto = calls[0][0] as Record<string, unknown>;
      expect(dto).not.toHaveProperty('rating');
      expect(dto).not.toHaveProperty('totalOrders');
      expect(dto).not.toHaveProperty('id');
    });

    it('400s a non-UUID id and a null for a NOT NULL column', async () => {
      await authed(
        request(app.getHttpServer()).get('/ops/vendors/not-a-uuid'),
      ).expect(400);
      await authed(request(app.getHttpServer()).patch(`/ops/vendors/${UUID}`))
        .send({ businessName: null })
        .expect(400);
      expect(vendorsService.get).not.toHaveBeenCalled();
      expect(vendorsService.update).not.toHaveBeenCalled();
    });

    it('removes an offering', async () => {
      const res = await authed(
        request(app.getHttpServer()).delete(
          `/ops/vendors/${UUID}/offerings/${UUID}`,
        ),
      ).expect(200);
      expect(res.body).toEqual({ removed: true });
    });
  });

  describe('GET /ops/me', () => {
    it('401s without a token', async () => {
      await request(app.getHttpServer()).get('/ops/me').expect(401);
    });

    it('lets any staff role confirm their session — including support', async () => {
      asRole('ebun_support');
      const res = await request(app.getHttpServer())
        .get('/ops/me')
        .set('Authorization', 'Bearer ok')
        .expect(200);
      expect(res.body).toEqual({
        name: 'Staffer',
        email: 'x@y.z',
        role: 'ebun_support',
      });
    });

    it('refuses a non-staff account', async () => {
      asRole('sender');
      await request(app.getHttpServer())
        .get('/ops/me')
        .set('Authorization', 'Bearer ok')
        .expect(403);
    });
  });
});
