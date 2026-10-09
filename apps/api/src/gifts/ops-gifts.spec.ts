import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { FulfillmentType } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { StaffGuard } from '../auth/staff.guard';
import { UsersService } from '../users/users.service';
import { GiftTemplatesRepository } from './gift-templates.repository';
import { OpsGiftsController } from './ops-gifts.controller';
import { OpsGiftsService } from './ops-gifts.service';

const UUID = '3f2b1a40-5c8e-4d61-9a7b-1c2d3e4f5a6b';

const row = (over: Record<string, unknown> = {}) => ({
  id: UUID,
  name: 'Burger meal',
  description: 'Flame-grilled beef burger with fries.',
  category: 'food' as const,
  base_price: 600000,
  delivery_type: FulfillmentType.DigitalVoucher,
  delivery_window: null,
  image_url: null,
  requires_address: false,
  available: false,
  featured: false,
  sort_order: 0,
  created_at: '2026-10-09T00:00:00.000Z',
  updated_at: '2026-10-09T00:00:00.000Z',
  ...over,
});

const staff = { userId: 'staff-1', role: 'ebun_admin' } as never;
const meta = { ipAddress: null, userAgent: null };

describe('OpsGiftsService', () => {
  let sut: OpsGiftsService;
  let repository: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    repository = {
      findAllForOps: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((v: Record<string, unknown>) =>
          Promise.resolve(row(v)),
        ),
      update: jest.fn().mockResolvedValue(row()),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpsGiftsService,
        { provide: GiftTemplatesRepository, useValue: repository },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    sut = moduleRef.get(OpsGiftsService);
  });

  it('lists withheld gifts too — ops needs to see what it is hiding', async () => {
    repository.findAllForOps.mockResolvedValue([
      row({ available: true }),
      row({ id: 'b', available: false }),
    ]);

    const result = await sut.list();

    expect(result).toHaveLength(2);
    expect(result.map((g) => g.available)).toEqual([true, false]);
  });

  it('creates a new gift off sale by default', async () => {
    // A price typed mid-meeting should not go live before anyone checks it.
    await sut.create(
      {
        name: 'Burger meal',
        category: 'food',
        basePrice: 600000,
        deliveryType: FulfillmentType.DigitalVoucher,
      },
      staff,
      meta,
    );

    const inserted = (
      repository.create.mock.calls as unknown[][]
    )[0][0] as Record<string, unknown>;
    expect(inserted.available).toBe(false);
    expect(inserted.base_price).toBe(600000);
  });

  it('respects an explicit request to create a gift already on sale', async () => {
    await sut.create(
      {
        name: 'Burger meal',
        category: 'food',
        basePrice: 600000,
        deliveryType: FulfillmentType.DigitalVoucher,
        available: true,
      },
      staff,
      meta,
    );

    const inserted = (
      repository.create.mock.calls as unknown[][]
    )[0][0] as Record<string, unknown>;
    expect(inserted.available).toBe(true);
  });

  it('audits a creation', async () => {
    await sut.create(
      {
        name: 'Burger meal',
        category: 'food',
        basePrice: 600000,
        deliveryType: FulfillmentType.DigitalVoucher,
      },
      staff,
      meta,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'GIFT_TEMPLATE_CREATED',
        resourceType: 'gift_template',
        actorId: 'staff-1',
      }),
    );
  });

  it('writes only the columns that actually changed', async () => {
    repository.findById.mockResolvedValue(
      row({ name: 'Burger meal', base_price: 600000 }),
    );
    repository.update.mockResolvedValue(row({ base_price: 650000 }));

    await sut.update(
      UUID,
      { name: 'Burger meal', basePrice: 650000 },
      staff,
      meta,
    );

    const [, changed] = (repository.update.mock.calls as unknown[][])[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(changed).toEqual({ base_price: 650000 });
  });

  it('skips the write and the audit row when nothing differs', async () => {
    repository.findById.mockResolvedValue(row({ name: 'Burger meal' }));

    await sut.update(UUID, { name: 'Burger meal' }, staff, meta);

    expect(repository.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records a price change in the audit metadata', async () => {
    repository.findById.mockResolvedValue(row({ base_price: 600000 }));
    repository.update.mockResolvedValue(row({ base_price: 650000 }));

    await sut.update(UUID, { basePrice: 650000 }, staff, meta);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'GIFT_TEMPLATE_UPDATED',
        metadata: expect.objectContaining({
          basePriceFrom: 600000,
          basePriceTo: 650000,
        }) as unknown,
      }),
    );
  });

  it('records going on and off sale as a state change', async () => {
    repository.findById.mockResolvedValue(row({ available: false }));
    repository.update.mockResolvedValue(row({ available: true }));

    await sut.update(UUID, { available: true }, staff, meta);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        previousState: 'withheld',
        newState: 'available',
      }),
    );
  });

  it('404s on an unknown gift', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(sut.get(UUID)).rejects.toMatchObject({ status: 404 });
    await expect(
      sut.update(UUID, { name: 'x' }, staff, meta),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});

/**
 * Real HTTP, real StaffGuard, real ValidationPipe — only the service is
 * mocked. Proves the routes are protected and that the fulfilment types
 * nothing can complete cannot be created through them.
 */
describe('ops gift routes over HTTP', () => {
  let app: INestApplication<App>;
  let gifts: Record<string, jest.Mock>;
  let auth: { verifyAccessToken: jest.Mock };
  let users: { findStaffByAuthId: jest.Mock };

  const VALID = {
    name: 'Burger meal',
    category: 'food',
    basePrice: 600000,
    deliveryType: 'digital_voucher',
  };

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
    gifts = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ id: UUID }),
      create: jest.fn().mockResolvedValue({ id: UUID }),
      update: jest.fn().mockResolvedValue({ id: UUID }),
    };
    auth = { verifyAccessToken: jest.fn() };
    users = { findStaffByAuthId: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [OpsGiftsController],
      providers: [
        StaffGuard,
        { provide: OpsGiftsService, useValue: gifts },
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

  it('401s every route without a token, calling no service', async () => {
    const server = app.getHttpServer();
    await request(server).get('/ops/gifts').expect(401);
    await request(server).post('/ops/gifts').send(VALID).expect(401);
    await request(server).get(`/ops/gifts/${UUID}`).expect(401);
    await request(server)
      .patch(`/ops/gifts/${UUID}`)
      .send({ name: 'x' })
      .expect(401);

    for (const fn of Object.values(gifts)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('403s roles that may not change what is on sale', async () => {
    for (const role of ['ebun_support', 'ebun_finance', 'vendor', 'sender']) {
      asRole(role);
      await request(app.getHttpServer())
        .post('/ops/gifts')
        .set('Authorization', 'Bearer good')
        .send(VALID)
        .expect(403);
    }
    expect(gifts.create).not.toHaveBeenCalled();
  });

  it('refuses a fulfilment type nothing can actually complete', async () => {
    // physical and experience both take the money and then raise.
    asRole('ebun_admin');
    for (const deliveryType of ['physical', 'experience', 'nonsense']) {
      await request(app.getHttpServer())
        .post('/ops/gifts')
        .set('Authorization', 'Bearer good')
        .send({ ...VALID, deliveryType })
        .expect(400);
    }
    expect(gifts.create).not.toHaveBeenCalled();
  });

  it('rejects a price that is not whole kobo or is implausibly small', async () => {
    asRole('ebun_admin');
    for (const basePrice of [0, 50, -100, 12.5, 'free']) {
      await request(app.getHttpServer())
        .post('/ops/gifts')
        .set('Authorization', 'Bearer good')
        .send({ ...VALID, basePrice })
        .expect(400);
    }
    expect(gifts.create).not.toHaveBeenCalled();
  });

  it('rejects a category outside the schema check constraint', async () => {
    asRole('ebun_ops');
    await request(app.getHttpServer())
      .post('/ops/gifts')
      .set('Authorization', 'Bearer good')
      .send({ ...VALID, category: 'gadgets' })
      .expect(400);
  });

  it('rejects an image url that is not a url', async () => {
    asRole('ebun_ops');
    await request(app.getHttpServer())
      .post('/ops/gifts')
      .set('Authorization', 'Bearer good')
      .send({ ...VALID, imageUrl: 'not-a-url' })
      .expect(400);
  });

  it('accepts a valid gift and strips anything not on the DTO', async () => {
    asRole('ebun_admin');
    await request(app.getHttpServer())
      .post('/ops/gifts')
      .set('Authorization', 'Bearer good')
      .send({
        ...VALID,
        id: 'forged',
        createdAt: '1999-01-01',
        digitalOnly: true,
      })
      .expect(201);

    const dto = (gifts.create.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto).not.toHaveProperty('digitalOnly');
    expect(dto.name).toBe('Burger meal');
  });

  it('offers no way to delete a gift', async () => {
    // Orders reference gift_template_id forever; taking one off sale is
    // the supported path.
    asRole('ebun_admin');
    await request(app.getHttpServer())
      .delete(`/ops/gifts/${UUID}`)
      .set('Authorization', 'Bearer good')
      .expect(404);
  });

  it('never caches a catalogue response', async () => {
    asRole('ebun_ops');
    const response = await request(app.getHttpServer())
      .get('/ops/gifts')
      .set('Authorization', 'Bearer good')
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
