import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { FulfillmentType, OrderStatus } from '@ebun/types';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { PricingService } from '../pricing/pricing.service';
import {
  MAX_MEDIA_SECONDS,
  MessageMediaKind,
  MessageMediaService,
  UploadedMedia,
} from '../media/message-media.service';
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
    private readonly pricing: PricingService,
    private readonly media: MessageMediaService,
  ) {}

  async execute(
    dto: CreateOrderDto,
    senderIp: string | undefined,
    recording?: UploadedMedia,
  ): Promise<CreateOrderResult> {
    // Checked FIRST, before the gift lookup: pure, local checks with no
    // I/O, so a request that's going to be rejected regardless of the
    // gift template shouldn't cost a DB round-trip first. (Found via a
    // live HTTP test — when this ran after the gift lookup, an
    // unreachable DB turned an instant 400 into a delayed 500.)
    const mediaKind = this.checkMessage(dto, recording);

    const giftTemplate = await this.giftsService.findAvailableById(
      dto.giftTemplateId,
    );

    // Stored before the order exists, so the row is written once with its
    // message. If anything below fails before the order is inserted, the
    // recording is deleted again rather than left with nothing pointing
    // at it.
    const messageKey =
      mediaKind && recording
        ? await this.media.store(mediaKind, recording)
        : null;
    const progress = { orderInserted: false };
    try {
      return await this.createWithMessage(
        dto,
        senderIp,
        giftTemplate,
        mediaKind,
        messageKey,
        progress,
      );
    } catch (err) {
      // Once the order row exists it points at the recording, so the
      // recording stays (a failed Paystack call leaves a draft order,
      // the same known gap as before; see below).
      if (messageKey && !progress.orderInserted) {
        await this.media.delete(messageKey);
      }
      throw err;
    }
  }

  /**
   * What kind of message this is, and whether what came with it fits.
   * Text: no file. Voice/video: exactly one recording, within the
   * Brief's length limits, and only while storage is switched on.
   */
  private checkMessage(
    dto: CreateOrderDto,
    recording: UploadedMedia | undefined,
  ): MessageMediaKind | null {
    const type = dto.messageType ?? 'text';
    if (type === 'text') {
      if (recording) {
        throw new BadRequestException(
          'A recording was attached to a written message. Choose voice or video, or remove the recording.',
        );
      }
      return null;
    }

    const kind = type as MessageMediaKind;
    if (!this.media.isEnabled()) {
      throw new BadRequestException(
        "Voice and video messages aren't available just now. Please write your message instead.",
      );
    }
    if (!recording || recording.size === 0) {
      throw new BadRequestException(
        kind === 'voice'
          ? 'Record your voice note before paying.'
          : 'Record your video before paying.',
      );
    }
    if (
      dto.messageDurationSecs !== undefined &&
      dto.messageDurationSecs > MAX_MEDIA_SECONDS[kind]
    ) {
      throw new BadRequestException(
        kind === 'voice'
          ? 'Voice notes can be up to 60 seconds.'
          : 'Videos can be up to 30 seconds.',
      );
    }
    return kind;
  }

  private async createWithMessage(
    dto: CreateOrderDto,
    senderIp: string | undefined,
    giftTemplate: Awaited<ReturnType<GiftsService['findAvailableById']>>,
    mediaKind: MessageMediaKind | null,
    messageKey: string | null,
    progress: { orderInserted: boolean },
  ): Promise<CreateOrderResult> {
    const sender = await this.usersService.findOrCreateGuestSender({
      email: dto.senderEmail,
      phone: dto.senderPhone,
      name: dto.senderName,
    });

    // Server-computed, never client-supplied — same principle as "backend never trusts frontend payment status" extended to price. PricingService is also what GET /gifts uses, so this is the exact total the sender read before paying.
    const {
      giftValue,
      deliveryFee,
      serviceFee,
      total: totalAmount,
    } = this.pricing.priceGift(
      giftTemplate.base_price,
      giftTemplate.delivery_type,
    );

    const paystackReference = `ebun_${randomUUID()}`;

    const createOrder = (input: Parameters<OrdersService['create']>[0]) =>
      this.ordersService.create(input) as Promise<{
        id: string;
        order_number: string | null;
      }>;

    const order = await createOrder({
      senderId: sender.id,
      giftTemplateId: giftTemplate.id,
      recipientName: dto.recipientName,
      recipientPhone: dto.recipientPhone,
      senderMessage: dto.senderMessage,
      messageType: mediaKind ?? dto.messageType,
      messageUrl: messageKey,
      messageDurationSecs: mediaKind ? (dto.messageDurationSecs ?? null) : null,
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
      // Only for doorstep gifts, and only with both an address and an
      // area — half an address is no use to a rider.
      delivery:
        giftTemplate.delivery_type === FulfillmentType.Physical &&
        dto.deliveryAddress &&
        dto.deliveryArea
          ? {
              address: dto.deliveryAddress,
              area: dto.deliveryArea,
              note: dto.deliveryNote ?? null,
            }
          : null,
    });

    progress.orderInserted = true;

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
