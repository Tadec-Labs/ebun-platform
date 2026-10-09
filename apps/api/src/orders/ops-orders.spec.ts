import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrderStatus } from '@ebun/types';
import { AuditEventsRepository } from '../audit/audit-events.repository';
import { AuthService } from '../auth/auth.service';
import { StaffGuard } from '../auth/staff.guard';
import { UsersService } from '../users/users.service';
import { STUCK_FULFILLMENT_MINUTES } from '../jobs/jobs.config';
import { OrderStateMachineService } from './order-state-machine.service';
import { OpsOrdersController } from './ops-orders.controller';
import {
  OpsOrdersRepository,
  sanitiseSearchTerm,
} from './ops-orders.repository';
import { OpsOrdersService } from './ops-orders.service';

const UUID = '3f2b1a40-5c8e-4d61-9a7b-1c2d3e4f5a6b';

const row = (over: Record<string, unknown> = {}) => ({
  id: UUID,
  order_number: 'EBN-0001',
  status: OrderStatus.ReadyForRedemption,
  recipient_name: 'Ada',
  recipient_phone: '+2348012345678',
  total_amount: 800000,
  created_at: '2026-10-09T10:00:00.000Z',
  updated_at: '2026-10-09T10:00:00.000Z',
  expires_at: '2026-11-08T10:00:00.000Z',
  scheduled_send_at: null,
  gift_template: { name: 'A Pizza, On Him' },
  vendor: null,
  ...over,
});

const detailRow = (over: Record<string, unknown> = {}) =>
  row({
    gift_value: 800000,
    delivery_fee: 0,
    service_fee: 0,
    vendor_payout_amount: null,
    vendor_paid_at: null,
    paystack_reference: 'ref_123',
    payment_verified_at: '2026-10-09T10:01:00.000Z',
    message_type: 'voice',
    reveal_theme: 'gold',
    reveal_opened_at: null,
    whatsapp_sent_at: '2026-10-09T10:02:00.000Z',
    delivery_address: null,
    delivery_zone: null,
    is_diaspora_sender: false,
    is_corporate_order: false,
    sender_country_code: 'NG',
    notes: null,
    ...over,
  });

describe('sanitiseSearchTerm', () => {
  it('strips the characters that would rewrite a PostgREST or= expression', () => {
    // Without this, a search term can close the ilike and append its
    // own filter, reading rows the query never meant to return.
    expect(sanitiseSearchTerm('Ada*,status.eq.paid')).toBe('Adastatuseqpaid');
    expect(sanitiseSearchTerm('a)b(c')).toBe('abc');
  });

  it('keeps everything a real search needs', () => {
    expect(sanitiseSearchTerm('EBN-0042')).toBe('EBN-0042');
    expect(sanitiseSearchTerm('+2348012345678')).toBe('+2348012345678');
    expect(sanitiseSearchTerm('  Ada Obi  ')).toBe('Ada Obi');
  });
});

describe('OpsOrdersService', () => {
  let sut: OpsOrdersService;
  let orders: Record<string, jest.Mock>;
  let auditEvents: Record<string, jest.Mock>;

  beforeEach(async () => {
    orders = {
      list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      countStuck: jest.fn().mockResolvedValue(0),
    };
    auditEvents = { findForResource: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpsOrdersService,
        OrderStateMachineService,
        { provide: OpsOrdersRepository, useValue: orders },
        { provide: AuditEventsRepository, useValue: auditEvents },
      ],
    }).compile();

    sut = moduleRef.get(OpsOrdersService);
  });

  it('reports stuck orders across the whole table, not just the filtered page', async () => {
    // Filtering to, say, `redeemed` must not hide the fact that four
    // paid orders are sitting half-fulfilled somewhere else.
    orders.countStuck.mockResolvedValue(4);
    orders.list.mockResolvedValue({ rows: [row()], total: 1 });

    const result = await sut.list({ status: [OrderStatus.Redeemed] });

    expect(result.stuckCount).toBe(4);
    expect(result.total).toBe(1);
    expect(result.stuckAfterMinutes).toBe(STUCK_FULFILLMENT_MINUTES);
  });

  it('flags a row as stuck using the same rule as the sweep', async () => {
    const longAgo = new Date(
      Date.now() - (STUCK_FULFILLMENT_MINUTES + 5) * 60_000,
    ).toISOString();
    orders.list.mockResolvedValue({
      rows: [
        row({
          id: 'a',
          status: OrderStatus.FulfillmentInProgress,
          updated_at: longAgo,
        }),
        // Same age, but a state the sweep doesn't watch.
        row({ id: 'b', status: OrderStatus.Redeemed, updated_at: longAgo }),
        // Watched state, but only just entered it.
        row({
          id: 'c',
          status: OrderStatus.Processing,
          updated_at: new Date().toISOString(),
        }),
      ],
      total: 3,
    });

    const result = await sut.list({});

    expect(result.orders.map((o) => o.stuck)).toEqual([true, false, false]);
  });

  it('defaults paging rather than reading the whole table', async () => {
    await sut.list({});

    const [filters] = orders.list.mock.calls[0] as [Record<string, unknown>];
    expect(filters.limit).toBe(50);
    expect(filters.offset).toBe(0);
  });

  it('flattens the embedded gift and vendor names', async () => {
    orders.list.mockResolvedValue({
      rows: [
        // PostgREST may hand back a one-element array instead of an object.
        row({ vendor: [{ business_name: 'Domino’s Lekki' }] }),
      ],
      total: 1,
    });

    const result = await sut.list({});

    expect(result.orders[0].giftName).toBe('A Pizza, On Him');
    expect(result.orders[0].vendorName).toBe('Domino’s Lekki');
  });

  it('returns the audit timeline and what the state machine would allow', async () => {
    orders.findById.mockResolvedValue(detailRow());
    auditEvents.findForResource.mockResolvedValue([
      {
        id: 'e1',
        event_type: 'ORDER_STATUS_CHANGED',
        actor_id: null,
        actor_type: 'webhook',
        resource_type: 'order',
        resource_id: UUID,
        previous_state: 'pending_payment',
        new_state: 'paid',
        metadata: { amount: 800000 },
        created_at: '2026-10-09T10:01:00.000Z',
      },
    ]);

    const result = await sut.get(UUID);

    expect(auditEvents.findForResource).toHaveBeenCalledWith('order', UUID);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].newState).toBe('paid');
    // ready_for_redemption: normal → reveal_opened/expired, admin → refunded.
    expect(result.allowedTransitions.normal).toEqual([
      OrderStatus.RevealOpened,
      OrderStatus.Expired,
    ]);
    expect(result.allowedTransitions.adminOverride).toEqual([
      OrderStatus.Refunded,
    ]);
    expect(result.terminal).toBe(false);
  });

  it('never exposes the sender’s message or the reveal token', async () => {
    orders.findById.mockResolvedValue(detailRow());

    const result = await sut.get(UUID);

    // The type forbids these; this asserts the runtime shape too, since
    // the row is cast out of Supabase and could carry extra columns.
    expect(result).not.toHaveProperty('senderMessage');
    expect(result).not.toHaveProperty('messageUrl');
    expect(result).not.toHaveProperty('revealToken');
    // What ops actually needs: that a message exists, and of what kind.
    expect(result.messageType).toBe('voice');
  });

  it('404s on an unknown order rather than returning an empty shell', async () => {
    orders.findById.mockResolvedValue(null);
    await expect(sut.get(UUID)).rejects.toThrow('Order not found.');
  });
});

describe('OpsOrdersController', () => {
  let app: INestApplication<App>;
  let service: Record<string, jest.Mock>;
  let role: string;

  beforeEach(async () => {
    role = 'ebun_ops';
    service = {
      list: jest.fn().mockResolvedValue({
        orders: [],
        total: 0,
        limit: 50,
        offset: 0,
        stuckCount: 0,
        stuckAfterMinutes: 15,
      }),
      get: jest.fn().mockResolvedValue({ id: UUID }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [OpsOrdersController],
      providers: [
        { provide: OpsOrdersService, useValue: service },
        StaffGuard,
        {
          provide: AuthService,
          useValue: {
            verifyAccessToken: jest.fn().mockResolvedValue({ authId: 'a1' }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findStaffByAuthId: jest.fn().mockImplementation(() =>
              Promise.resolve({
                id: 'u1',
                role,
                is_active: true,
                email: null,
                name: null,
              }),
            ),
          },
        },
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

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', 'Bearer t');

  it('rejects an unauthenticated caller', async () => {
    await request(app.getHttpServer()).get('/ops/orders').expect(401);
  });

  it('lets finance read orders', async () => {
    role = 'ebun_finance';
    await get('/ops/orders').expect(200);
  });

  it('does not let support read orders — these rows carry a third party’s phone number', async () => {
    role = 'ebun_support';
    await get('/ops/orders').expect(403);
  });

  it('coerces a single status into an array and rejects an unknown one', async () => {
    await get('/ops/orders?status=paid').expect(200);
    const [query] = service.list.mock.calls[0] as [Record<string, unknown>];
    expect(query.status).toEqual(['paid']);

    await get('/ops/orders?status=not_a_state').expect(400);
  });

  it('caps the page size', async () => {
    await get('/ops/orders?limit=500').expect(400);
  });

  it('marks responses no-store', async () => {
    const res = await get('/ops/orders').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rejects a non-uuid order id before it reaches the service', async () => {
    await get('/ops/orders/not-a-uuid').expect(400);
    expect(service.get).not.toHaveBeenCalled();
  });
});
