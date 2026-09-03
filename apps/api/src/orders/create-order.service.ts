import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string | null;
  checkoutUrl: string;
}

@Injectable()
export class CreateOrderService {
  constructor(
    private readonly giftsService: GiftsService,
    private readonly usersService: UsersService,
    private readonly ordersService: OrdersService,
    private readonly paystackClient: PaystackClientService,
  ) {}

  async execute(
    dto: CreateOrderDto,
    senderIp: string | undefined,
  ): Promise<CreateOrderResult> {
    // Only text messages are supported at creation right now — voice/video need a Cloudflare R2 presigned-upload step that isn't built yet. Checked FIRST, before the gift lookup: this is a pure, local check with no I/O, so a request that's going to be rejected regardless of the gift template shouldn't cost a DB round-trip first. (Found via a live HTTP test against a running server — originally this ran after the gift lookup, which meant an unreachable/slow DB turned an instant 400 into a delayed 500.)
    if (dto.messageType && dto.messageType !== 'text') {
      throw new BadRequestException(
        `messageType "${dto.messageType}" is not yet supported — only "text" messages can be attached at order creation for now.`,
      );
    }

    const giftTemplate = await this.giftsService.findAvailableById(
      dto.giftTemplateId,
    );

    const sender = await this.usersService.findOrCreateGuestSender({
      email: dto.senderEmail,
      phone: dto.senderPhone,
      name: dto.senderName,
    });

    // Server-computed, never client-supplied — same principle as "backend never trusts frontend payment status" extended to price.
    const giftValue = giftTemplate.base_price;
    // PLACEHOLDER — no delivery/service fee schedule has been specified anywhere in the Brief excerpts seen so far. Both are 0 until there's a real pricing rule to implement; flagged here rather than silently invented.
    const deliveryFee = 0;
    const serviceFee = 0;
    const totalAmount = giftValue + deliveryFee + serviceFee;

    const paystackReference = `ebun_${randomUUID()}`;

    const createOrder = this.ordersService.create as unknown as (
      input: Record<string, unknown>,
    ) => Promise<{ id: string; order_number: string | null }>;

    const order = await createOrder({
      senderId: sender.id,
      giftTemplateId: giftTemplate.id,
      recipientName: dto.recipientName,
      recipientPhone: dto.recipientPhone,
      senderMessage: dto.senderMessage,
      messageType: dto.messageType,
      scheduledSendAt: dto.scheduledSendAt,
      paystackReference,
      totalAmount,
      giftValue,
      deliveryFee,
      serviceFee,
      senderIp,
      senderCountryCode: dto.senderCountryCode,
      isDiasporaSender: !!(
        dto.senderCountryCode && dto.senderCountryCode !== 'NG'
      ),
    });

    // Paystack call happens AFTER the order exists but BEFORE the
    // draft -> pending_payment transition. If Paystack's call fails,
    // the order simply stays 'draft' — never falsely marked as awaiting
    // a payment that was never actually initiated with Paystack. The
    // caller can retry order creation; a stuck 'draft' row from a failed
    // Paystack call isn't currently auto-cleaned (expire_unclaimed_gifts()
    // only handles ready_for_redemption/reveal_opened/voucher_issued),
    // which is a known minor gap, not addressed in this slice.
    const checkout = await this.paystackClient.initializeTransaction({
      email: dto.senderEmail,
      amountKobo: totalAmount,
      reference: paystackReference,
      metadata: { orderId: order.id, orderNumber: order.order_number },
    });

    await this.ordersService.transitionNormal(
      order.id,
      OrderStatus.Draft,
      OrderStatus.PendingPayment,
      { type: 'system' },
      { paystackReference },
    );

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      checkoutUrl: checkout.authorizationUrl,
    };
  }
}
