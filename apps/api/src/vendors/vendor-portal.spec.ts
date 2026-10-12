import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { RedemptionStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { OrdersService } from '../orders/orders.service';
import { PublicPhotosService } from '../storage/public-photos.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalGuard } from './vendor-portal.guard';
import { VendorPortalService } from './vendor-portal.service';
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
  let gifts: { createRequestedByVendor: jest.Mock; setImageUrl: jest.Mock };
  let orders: { findUpcomingPickups: jest.Mock; confirmPickup: jest.Mock };
  let photos: { upload: jest.Mock; deleteIfOurs: jest.Mock };

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
      listPortalOfferings: jest.fn().mockResolvedValue([]),
      setOfferingAvailability: jest.fn().mockResolvedValue(null),
      countAwaitingApproval: jest.fn().mockResolvedValue(0),
      findById: jest.fn().mockResolvedValue({
        id: 'vendor-1',
        category: 'food',
        commission_rate: 0.9,
      }),
      upsertOffering: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    photos = {
      upload: jest
        .fn()
        .mockResolvedValue('https://pub-abc.r2.dev/gifts/photo.webp'),
      deleteIfOurs: jest.fn().mockResolvedValue(undefined),
    };
    orders = {
      findUpcomingPickups: jest.fn().mockResolvedValue([]),
      confirmPickup: jest.fn().mockResolvedValue(null),
    };
    gifts = {
      setImageUrl: jest.fn().mockResolvedValue(null),
      createRequestedByVendor: jest.fn().mockResolvedValue({
        id: GIFT_ID,
        name: 'Jollof & Chicken',
        image_url: null,
        base_price: 450000,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [VendorPortalController],
      providers: [
        VendorPortalGuard,
        // Real: the rules about what a vendor may change are under test.
        VendorPortalService,
        { provide: GiftsService, useValue: gifts },
        { provide: OrdersService, useValue: orders },
        { provide: PublicPhotosService, useValue: photos },
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

  describe('their own items', () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };

    it('401s every item route with no token', async () => {
      const server = app.getHttpServer();
      await request(server).get('/vendor/offerings').expect(401);
      await request(server)
        .patch(`/vendor/offerings/${GIFT_ID}`)
        .send({ available: false })
        .expect(401);
      await request(server)
        .post('/vendor/offerings')
        .send({ name: 'Jollof', inStorePrice: 450000 })
        .expect(401);
      expect(vendors.setOfferingAvailability).not.toHaveBeenCalled();
      expect(gifts.createRequestedByVendor).not.toHaveBeenCalled();
    });

    it('lists items with where each one stands, live first', async () => {
      asVendor();
      vendors.listPortalOfferings.mockResolvedValue([
        {
          gift_template_id: 'b',
          vendor_price: 405000,
          available: true,
          approved: false,
          gift_templates: {
            name: 'Asked for',
            base_price: 450000,
            image_url: null,
            available: false,
          },
        },
        {
          gift_template_id: 'a',
          vendor_price: 720000,
          available: false,
          approved: true,
          gift_templates: {
            name: 'Pizza',
            base_price: 800000,
            image_url: null,
            available: true,
          },
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/vendor/offerings')
        .set(auth)
        .expect(200);

      expect(vendors.listPortalOfferings).toHaveBeenCalledWith('vendor-1');
      expect(response.body).toEqual([
        {
          giftTemplateId: 'a',
          name: 'Pizza',
          imageUrl: null,
          inStorePrice: 800000,
          youReceive: 720000,
          available: false,
          status: 'live',
        },
        {
          giftTemplateId: 'b',
          name: 'Asked for',
          imageUrl: null,
          inStorePrice: 450000,
          youReceive: 405000,
          available: true,
          status: 'awaiting_approval',
        },
      ]);
    });

    it('marks an item sold out, scoped to this vendor, and audits it as the vendor', async () => {
      asVendor();
      vendors.setOfferingAvailability.mockResolvedValue({
        gift_template_id: GIFT_ID,
        vendor_price: 720000,
        available: false,
        approved: true,
        gift_templates: {
          name: 'Pizza',
          base_price: 800000,
          image_url: null,
          available: true,
        },
      });

      const response = await request(app.getHttpServer())
        .patch(`/vendor/offerings/${GIFT_ID}`)
        .set(auth)
        .send({ available: false })
        .expect(200);

      expect(vendors.setOfferingAvailability).toHaveBeenCalledWith(
        'vendor-1',
        GIFT_ID,
        false,
      );
      expect(response.body).toMatchObject({ available: false, status: 'live' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'vendor_offering.availability_changed',
          actorType: 'vendor',
          resourceId: 'vendor-1',
          newState: 'sold_out',
        }),
      );
    });

    it("404s an item this vendor doesn't sell", async () => {
      asVendor();
      vendors.setOfferingAvailability.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`/vendor/offerings/${GIFT_ID}`)
        .set(auth)
        .send({ available: true })
        .expect(404);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('400s a malformed availability change before touching data', async () => {
      asVendor();
      const server = app.getHttpServer();
      await request(server)
        .patch(`/vendor/offerings/${GIFT_ID}`)
        .set(auth)
        .send({ available: 'no' })
        .expect(400);
      await request(server)
        .patch('/vendor/offerings/not-a-uuid')
        .set(auth)
        .send({ available: false })
        .expect(400);
      expect(vendors.setOfferingAvailability).not.toHaveBeenCalled();
    });

    it('turns a new item request into an off-sale gift and an unapproved offering at their 90% share', async () => {
      asVendor();

      const response = await request(app.getHttpServer())
        .post('/vendor/offerings')
        .set(auth)
        .send({
          name: '  Jollof & Chicken ',
          description: 'Party jollof, one drumstick',
          inStorePrice: 450000,
          // Not the vendor's to set — dropped by the whitelist.
          approved: true,
          vendorPrice: 449900,
        })
        .expect(201);

      expect(gifts.createRequestedByVendor).toHaveBeenCalledWith({
        name: 'Jollof & Chicken',
        description: 'Party jollof, one drumstick',
        inStorePrice: 450000,
        category: 'food',
        imageUrl: null,
      });
      expect(vendors.upsertOffering).toHaveBeenCalledWith({
        vendor_id: 'vendor-1',
        gift_template_id: GIFT_ID,
        vendor_price: 405000,
        available_zones: null,
        available: true,
        approved: false,
      });
      expect(response.body).toMatchObject({
        status: 'awaiting_approval',
        youReceive: 405000,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'vendor_offering.requested',
          actorType: 'vendor',
        }),
      );
    });

    it('400s a price that is clearly a typo', async () => {
      asVendor();
      const server = app.getHttpServer();
      // ₦45 — naira typed into a kobo field the other way round
      await request(server)
        .post('/vendor/offerings')
        .set(auth)
        .send({ name: 'Jollof', inStorePrice: 4500 })
        .expect(400);
      await request(server)
        .post('/vendor/offerings')
        .set(auth)
        .send({ name: 'Jollof', inStorePrice: 4500.5 })
        .expect(400);
      expect(gifts.createRequestedByVendor).not.toHaveBeenCalled();
    });

    it('stops at ten requests waiting for ops', async () => {
      asVendor();
      vendors.countAwaitingApproval.mockResolvedValue(10);

      await request(app.getHttpServer())
        .post('/vendor/offerings')
        .set(auth)
        .send({ name: 'Jollof', inStorePrice: 450000 })
        .expect(400);
      expect(gifts.createRequestedByVendor).not.toHaveBeenCalled();
    });
  });

  describe('who is coming to collect', () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const ORDER_ID = '44444444-4444-4444-8444-444444444444';

    it('401s the pickup routes with no token', async () => {
      const server = app.getHttpServer();
      await request(server).get('/vendor/pickups').expect(401);
      await request(server)
        .post(`/vendor/pickups/${ORDER_ID}/confirm`)
        .expect(401);
      expect(orders.findUpcomingPickups).not.toHaveBeenCalled();
      expect(orders.confirmPickup).not.toHaveBeenCalled();
    });

    it("lists this vendor's bookings by first name — never the collection code", async () => {
      asVendor();
      orders.findUpcomingPickups.mockResolvedValue([
        {
          id: ORDER_ID,
          recipient_name: 'Adaeze Okonkwo',
          pickup_at: '2026-10-12T11:30:00.000Z',
          pickup_confirmed_at: null,
          gift_templates: { name: 'Large Pepperoni' },
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/vendor/pickups')
        .set(auth)
        .expect(200);

      expect(orders.findUpcomingPickups).toHaveBeenCalledWith(
        'vendor-1',
        expect.any(Date),
      );
      expect(response.body).toEqual([
        {
          orderId: ORDER_ID,
          giftName: 'Large Pepperoni',
          recipientFirstName: 'Adaeze',
          pickupAt: '2026-10-12T11:30:00.000Z',
          confirmed: false,
        },
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/EBN-/);
    });

    it('confirms a booking, scoped to this vendor, and audits it as the vendor', async () => {
      asVendor();
      orders.confirmPickup.mockResolvedValue({
        id: ORDER_ID,
        pickup_at: '2026-10-12T11:30:00.000Z',
      });

      await request(app.getHttpServer())
        .post(`/vendor/pickups/${ORDER_ID}/confirm`)
        .set(auth)
        .expect(201);

      expect(orders.confirmPickup).toHaveBeenCalledWith(ORDER_ID, 'vendor-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'order.pickup_confirmed',
          actorType: 'vendor',
          resourceId: ORDER_ID,
        }),
      );
    });

    it("404s a booking that isn't for this vendor", async () => {
      asVendor();
      orders.confirmPickup.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post(`/vendor/pickups/${ORDER_ID}/confirm`)
        .set(auth)
        .expect(404);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('photos and profile', () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

    it('takes a photo with a new item as one multipart request', async () => {
      asVendor();

      await request(app.getHttpServer())
        .post('/vendor/offerings')
        .set(auth)
        .field('name', 'Jollof & Chicken')
        .field('inStorePrice', '450000')
        .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(photos.upload).toHaveBeenCalledWith(
        expect.objectContaining({ size: JPEG.length }),
        'gifts',
      );
      expect(gifts.createRequestedByVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          inStorePrice: 450000,
          imageUrl: 'https://pub-abc.r2.dev/gifts/photo.webp',
        }),
      );
    });

    it("deletes the uploaded photo if the item can't be created", async () => {
      asVendor();
      gifts.createRequestedByVendor.mockRejectedValue(new Error('db down'));

      await request(app.getHttpServer())
        .post('/vendor/offerings')
        .set(auth)
        .field('name', 'Jollof')
        .field('inStorePrice', '450000')
        .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(500);

      expect(photos.deleteIfOurs).toHaveBeenCalledWith(
        'https://pub-abc.r2.dev/gifts/photo.webp',
      );
    });

    it('rejects an oversized upload before it reaches the service', async () => {
      asVendor();
      await request(app.getHttpServer())
        .post(`/vendor/offerings/${GIFT_ID}/photo`)
        .set(auth)
        .attach('photo', Buffer.alloc(1_000_001, 1), {
          filename: 'big.jpg',
          contentType: 'image/jpeg',
        })
        .expect(413);
      expect(photos.upload).not.toHaveBeenCalled();
    });

    it('adds a photo to an item waiting for approval, replacing the old file', async () => {
      asVendor();
      vendors.listPortalOfferings.mockResolvedValue([
        {
          gift_template_id: GIFT_ID,
          vendor_price: 405000,
          available: true,
          approved: false,
          gift_templates: {
            name: 'Jollof',
            base_price: 450000,
            image_url: null,
            available: false,
          },
        },
      ]);
      gifts.setImageUrl.mockResolvedValue(
        'https://pub-abc.r2.dev/gifts/old.jpg',
      );

      const response = await request(app.getHttpServer())
        .post(`/vendor/offerings/${GIFT_ID}/photo`)
        .set(auth)
        .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(gifts.setImageUrl).toHaveBeenCalledWith(
        GIFT_ID,
        'https://pub-abc.r2.dev/gifts/photo.webp',
      );
      expect(photos.deleteIfOurs).toHaveBeenCalledWith(
        'https://pub-abc.r2.dev/gifts/old.jpg',
      );
      expect(response.body).toMatchObject({
        imageUrl: 'https://pub-abc.r2.dev/gifts/photo.webp',
      });
    });

    it("won't let a vendor swap the photo of a live item senders have already seen", async () => {
      asVendor();
      vendors.listPortalOfferings.mockResolvedValue([
        {
          gift_template_id: GIFT_ID,
          vendor_price: 405000,
          available: true,
          approved: true,
          gift_templates: {
            name: 'Jollof',
            base_price: 450000,
            image_url: 'https://pub-abc.r2.dev/gifts/live.jpg',
            available: true,
          },
        },
      ]);

      await request(app.getHttpServer())
        .post(`/vendor/offerings/${GIFT_ID}/photo`)
        .set(auth)
        .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(400);
      expect(photos.upload).not.toHaveBeenCalled();
    });

    const vendorRow = (over: Record<string, unknown> = {}) => ({
      id: 'vendor-1',
      business_name: 'Mama Cass Kitchen',
      owner_name: 'Cass',
      category: 'food',
      commission_rate: 0.9,
      pickup_address: null,
      pickup_hours: null,
      bank_name: null,
      account_number: null,
      account_name: null,
      ...over,
    });

    it('shows the profile with bank details masked, and what is still missing', async () => {
      asVendor();
      vendors.findById.mockResolvedValue(
        vendorRow({
          bank_name: 'GTBank',
          account_number: '0123456789',
          account_name: 'Mama Cass Kitchen',
        }),
      );

      const response = await request(app.getHttpServer())
        .get('/vendor/profile')
        .set(auth)
        .expect(200);

      expect(response.body).toMatchObject({
        bank: {
          bankName: 'GTBank',
          accountName: 'Mama Cass Kitchen',
          accountLast4: '6789',
        },
      });
      expect(JSON.stringify(response.body)).not.toContain('0123456789');
      expect(response.body).toMatchObject({ missing: ['pickup address'] });
    });

    it('accepts bank details once, together, and never puts them in the audit log', async () => {
      asVendor();
      vendors.findById.mockResolvedValue(vendorRow());
      vendors.update.mockImplementation(
        (_id: string, values: Record<string, unknown>) =>
          Promise.resolve(vendorRow(values)),
      );

      await request(app.getHttpServer())
        .patch('/vendor/profile')
        .set(auth)
        .send({
          pickupAddress: '12 Oba Adesida Rd, Akure',
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: 'Mama Cass Kitchen',
        })
        .expect(200);

      expect(vendors.update).toHaveBeenCalledWith(
        'vendor-1',
        expect.objectContaining({ account_number: '0123456789' }),
      );
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        '0123456789',
      );
    });

    it('refuses to change bank details from the counter link once they are set', async () => {
      asVendor();
      vendors.findById.mockResolvedValue(
        vendorRow({ account_number: '0123456789' }),
      );

      await request(app.getHttpServer())
        .patch('/vendor/profile')
        .set(auth)
        .send({
          bankName: 'Other Bank',
          accountNumber: '9999999999',
          accountName: 'Someone Else',
        })
        .expect(400);
      expect(vendors.update).not.toHaveBeenCalled();
    });

    it('refuses half a set of bank details', async () => {
      asVendor();
      vendors.findById.mockResolvedValue(vendorRow());

      await request(app.getHttpServer())
        .patch('/vendor/profile')
        .set(auth)
        .send({ accountNumber: '0123456789' })
        .expect(400);
      expect(vendors.update).not.toHaveBeenCalled();
    });
  });
});
