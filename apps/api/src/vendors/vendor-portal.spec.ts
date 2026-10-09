import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { RedemptionStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalGuard } from './vendor-portal.guard';
import { VendorsRepository } from './vendors.repository';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const OTHER_TOKEN = '22222222-2222-4222-8222-222222222222';
const CODE = 'EBN-4M8K2L';
const GIFT_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Real HTTP, real VendorPortalGuard — only the data layer is mocked.
 * The point is proving the token actually gates these routes and that a
 * vendor cannot reach a code for a gift they do not sell.
 */
describe('vendor portal over HTTP', () => {
  let app: INestApplication<App>;
  let redemptions: Record<string, jest.Mock>;
  let vendors: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };

  const asVendor = (over: Record<string, unknown> = {}) => {
    vendors.findByPortalToken.mockResolvedValue({
      id: 'vendor-1',
      business_name: 'Mama Cass Kitchen',
      category: 'food',
      active: true,
      ...over,
    });
  };

  beforeEach(async () => {
    redemptions = {
      lookupForVendor: jest
        .fn()
        .mockResolvedValue({ code: CODE, redeemable: true }),
      completeByFallbackCode: jest.fn().mockResolvedValue({
        redemption: {
          id: 'redemption-1',
          redemption_number: 'RDM-0001',
          status: RedemptionStatus.Completed,
        },
        orderId: 'order-1',
      }),
    };
    vendors = {
      findByPortalToken: jest.fn().mockResolvedValue(null),
      findOffering: jest.fn().mockResolvedValue({ vendor_id: 'vendor-1' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [VendorPortalController],
      providers: [
        VendorPortalGuard,
        { provide: RedemptionsService, useValue: redemptions },
        { provide: VendorsRepository, useValue: vendors },
        { provide: AuditService, useValue: audit },
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

  describe('the token gate', () => {
    it('401s every route with no token, touching no data', async () => {
      const server = app.getHttpServer();
      await request(server).get('/vendor/me').expect(401);
      await request(server).get(`/vendor/redemptions/${CODE}`).expect(401);
      await request(server)
        .post(`/vendor/redemptions/${CODE}/complete`)
        .send({})
        .expect(401);

      expect(redemptions.lookupForVendor).not.toHaveBeenCalled();
      expect(redemptions.completeByFallbackCode).not.toHaveBeenCalled();
    });

    it('401s an unknown token', async () => {
      vendors.findByPortalToken.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get('/vendor/me')
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(401);
    });

    it('401s a deactivated vendor', async () => {
      // Deactivating in /ops is how you stop working with a vendor; it
      // must also stop them confirming collections.
      asVendor({ active: false });
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({})
        .expect(401);
      expect(redemptions.completeByFallbackCode).not.toHaveBeenCalled();
    });

    it('never reaches the database for a token that is not even a uuid', async () => {
      await request(app.getHttpServer())
        .get('/vendor/me')
        .set('Authorization', 'Bearer not-a-uuid')
        .expect(401);
      expect(vendors.findByPortalToken).not.toHaveBeenCalled();
    });

    it('gives the same message whether the token is unknown or deactivated', async () => {
      vendors.findByPortalToken.mockResolvedValue(null);
      const unknown = await request(app.getHttpServer())
        .get('/vendor/me')
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(401);

      asVendor({ active: false });
      const inactive = await request(app.getHttpServer())
        .get('/vendor/me')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(401);

      expect(unknown.body).toEqual(inactive.body);
    });

    it('names the business so staff can see whose till they are on', async () => {
      asVendor();
      const response = await request(app.getHttpServer())
        .get('/vendor/me')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      expect(response.body).toEqual({ businessName: 'Mama Cass Kitchen' });
    });

    it('leaks nothing else about the vendor', async () => {
      asVendor();
      const response = await request(app.getHttpServer())
        .get('/vendor/me')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('vendor-1');
      expect(body).not.toContain(TOKEN);
    });
  });

  describe('scoping to this vendor', () => {
    it('passes a gift-ownership check into the lookup', async () => {
      asVendor();
      await request(app.getHttpServer())
        .get(`/vendor/redemptions/${CODE}`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      const sellsGift = (
        redemptions.lookupForVendor.mock.calls as unknown[][]
      )[0][1] as (id: string) => Promise<boolean>;
      await expect(sellsGift(GIFT_ID)).resolves.toBe(true);
      expect(vendors.findOffering).toHaveBeenCalledWith('vendor-1', GIFT_ID);
    });

    it('reports a gift this vendor does not sell as not theirs', async () => {
      asVendor();
      vendors.findOffering.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get(`/vendor/redemptions/${CODE}`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      const sellsGift = (
        redemptions.lookupForVendor.mock.calls as unknown[][]
      )[0][1] as (id: string) => Promise<boolean>;
      await expect(sellsGift(GIFT_ID)).resolves.toBe(false);
    });

    it('still honours a gift the vendor has paused for new orders', async () => {
      // `available: false` means "send me no NEW orders", not "refuse
      // the one somebody already paid for".
      asVendor();
      vendors.findOffering.mockResolvedValue({
        vendor_id: 'vendor-1',
        available: false,
      });
      await request(app.getHttpServer())
        .get(`/vendor/redemptions/${CODE}`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      const sellsGift = (
        redemptions.lookupForVendor.mock.calls as unknown[][]
      )[0][1] as (id: string) => Promise<boolean>;
      await expect(sellsGift(GIFT_ID)).resolves.toBe(true);
    });

    it('carries the same check into the completion', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({})
        .expect(201);

      const params = (
        redemptions.completeByFallbackCode.mock.calls as unknown[][]
      )[0][0] as {
        sellsGift?: unknown;
        vendorId: string;
      };
      expect(typeof params.sellsGift).toBe('function');
      expect(params.vendorId).toBe('vendor-1');
    });

    it('credits the vendor the token identifies, never one supplied by the caller', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ vendorId: 'some-other-vendor' })
        .expect(201);

      const params = (
        redemptions.completeByFallbackCode.mock.calls as unknown[][]
      )[0][0] as {
        vendorId: string;
      };
      expect(params.vendorId).toBe('vendor-1');
    });
  });

  describe('confirming a collection', () => {
    it('records the business, and the staff name when given', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ confirmedBy: 'Blessing' })
        .expect(201);

      const params = (
        redemptions.completeByFallbackCode.mock.calls as unknown[][]
      )[0][0] as {
        confirmedBy: string;
        actorType: string;
      };
      expect(params.confirmedBy).toBe('Blessing (Mama Cass Kitchen)');
      // Not 'admin' — a vendor confirming is genuinely a different actor
      // from ops confirming on their behalf.
      expect(params.actorType).toBe('vendor');
    });

    it('falls back to the business name when nobody types theirs', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({})
        .expect(201);

      const params = (
        redemptions.completeByFallbackCode.mock.calls as unknown[][]
      )[0][0] as {
        confirmedBy: string;
      };
      expect(params.confirmedBy).toBe('Mama Cass Kitchen');
    });

    it('truncates an absurd staff name rather than storing it whole', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ confirmedBy: 'x'.repeat(500) })
        .expect(201);

      const params = (
        redemptions.completeByFallbackCode.mock.calls as unknown[][]
      )[0][0] as {
        confirmedBy: string;
      };
      expect(params.confirmedBy.length).toBeLessThan(120);
    });

    it('audits the collection as coming from the vendor portal', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/redemptions/${CODE}/complete`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({})
        .expect(201);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'REDEMPTION_COMPLETED',
          actorType: 'vendor',
          metadata: expect.objectContaining({
            vendorId: 'vendor-1',
            confirmedVia: 'vendor_portal',
          }) as unknown,
        }),
      );
    });
  });

  describe('the code itself', () => {
    it('rejects a malformed code before any lookup', async () => {
      asVendor();
      for (const bad of ['nonsense', 'EBN-4M8K2', 'EBN-4M8K2O']) {
        await request(app.getHttpServer())
          .get(`/vendor/redemptions/${encodeURIComponent(bad)}`)
          .set('Authorization', `Bearer ${TOKEN}`)
          .expect(400);
      }
      expect(redemptions.lookupForVendor).not.toHaveBeenCalled();
    });

    it('accepts the sloppy ways a code gets typed at a counter', async () => {
      asVendor();
      await request(app.getHttpServer())
        .get('/vendor/redemptions/ebn4m8k2l')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      expect(redemptions.lookupForVendor).toHaveBeenCalledWith(
        CODE,
        expect.any(Function),
      );
    });

    it('never caches a response', async () => {
      asVendor();
      const response = await request(app.getHttpServer())
        .get(`/vendor/redemptions/${CODE}`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
    });
  });
});
