import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { OrdersRepository } from './orders.repository';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

describe('OrdersRepository', () => {
  let sut: OrdersRepository;
  let supabase: { rpc: jest.Mock };

  beforeEach(async () => {
    supabase = { rpc: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersRepository,
        { provide: SUPABASE_CLIENT, useValue: supabase },
      ],
    }).compile();

    sut = moduleRef.get(OrdersRepository);
  });

  it('calls attempt_order_transition with correctly mapped p_-prefixed params', async () => {
    supabase.rpc.mockResolvedValue({
      data: { id: 'order-1', status: OrderStatus.Processing },
      error: null,
    });

    await sut.attemptTransition({
      orderId: 'order-1',
      expectedStatus: OrderStatus.Paid,
      newStatus: OrderStatus.Processing,
      actorType: 'webhook',
      metadata: { paystackReference: 'ref_123' },
    });

    expect(supabase.rpc).toHaveBeenCalledWith('attempt_order_transition', {
      p_order_id: 'order-1',
      p_expected_status: OrderStatus.Paid,
      p_new_status: OrderStatus.Processing,
      p_actor_type: 'webhook',
      p_actor_id: null,
      p_metadata: { paystackReference: 'ref_123' },
    });
  });

  it('returns null when the compare-and-swap fails (no error, null data) — not an exception', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await sut.attemptTransition({
      orderId: 'order-1',
      expectedStatus: OrderStatus.Paid,
      newStatus: OrderStatus.Processing,
      actorType: 'webhook',
    });

    expect(result).toBeNull();
  });

  it('throws when Supabase itself returns an error, rather than silently returning null', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: new Error('connection refused'),
    });

    await expect(
      sut.attemptTransition({
        orderId: 'order-1',
        expectedStatus: OrderStatus.Paid,
        newStatus: OrderStatus.Processing,
        actorType: 'webhook',
      }),
    ).rejects.toThrow('connection refused');
  });
});
