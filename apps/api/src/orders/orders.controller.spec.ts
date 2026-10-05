import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';
import { CreateOrderService } from './create-order.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// Route-level (real HTTP) coverage for the one public, unauthenticated
// GET endpoint. Services are mocked — this is about the route contract:
// path, param handling, status codes, and the cache header — not the
// mapping logic, which order-confirmation.spec.ts and
// orders.service.spec.ts already cover.
describe('OrdersController — GET /orders/confirmation/:reference', () => {
  let app: INestApplication<App>;
  let ordersService: { getConfirmation: jest.Mock };

  beforeEach(async () => {
    ordersService = { getConfirmation: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: CreateOrderService, useValue: { execute: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'https://ebun.example' },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the confirmation view as JSON, uncached', async () => {
    ordersService.getConfirmation.mockResolvedValue({
      status: 'confirmed',
      orderNumber: 'EBN-0042',
      recipientName: 'Ada',
      revealUrl: 'https://ebun.example/reveal/token-abc',
    });

    const res = await request(app.getHttpServer())
      .get('/orders/confirmation/ebun_abc-123')
      .expect(200);

    expect(res.body).toEqual({
      status: 'confirmed',
      orderNumber: 'EBN-0042',
      recipientName: 'Ada',
      revealUrl: 'https://ebun.example/reveal/token-abc',
    });
    // Polled while the payment webhook is still in flight — a cached
    // "awaiting_payment" would keep a paid sender waiting.
    expect(res.headers['cache-control']).toBe('no-store');
    // The base URL comes from config, not the request — confirms the
    // controller actually threads WEB_APP_BASE_URL through rather than
    // leaving the service to guess it.
    expect(ordersService.getConfirmation).toHaveBeenCalledWith(
      'ebun_abc-123',
      'https://ebun.example',
    );
  });

  it('URL-decodes the reference before looking it up', async () => {
    ordersService.getConfirmation.mockResolvedValue({
      status: 'awaiting_payment',
      orderNumber: null,
      recipientName: 'Chidi',
    });

    ordersService.getConfirmation.mockResolvedValue({
      status: 'awaiting_payment',
      orderNumber: null,
      recipientName: 'Chidi',
      revealUrl: null,
    });

    await request(app.getHttpServer())
      .get('/orders/confirmation/ebun_a%2Bb')
      .expect(200);

    expect(ordersService.getConfirmation).toHaveBeenCalledWith(
      'ebun_a+b',
      'https://ebun.example',
    );
  });

  it('responds 404 for an unknown reference', async () => {
    ordersService.getConfirmation.mockRejectedValue(
      new NotFoundException('No order found for this reference.'),
    );

    await request(app.getHttpServer())
      .get('/orders/confirmation/ebun_missing')
      .expect(404);
  });
});
