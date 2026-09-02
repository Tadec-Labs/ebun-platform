import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaystackWebhookDto } from './dto/paystack-webhook.dto';
import { verifyPaystackSignature } from './paystack-signature.util';

// Paystack sends every event type your account is subscribed to at the same webhook URL, not just payment confirmations (transfer.success, subscription.create, etc). Only this one triggers an order transition.

const HANDLED_EVENT = 'charge.success';

@Injectable()
export class PaystackWebhookService {
  private readonly logger = new Logger(PaystackWebhookService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  async handle(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    payload: PaystackWebhookDto,
  ): Promise<void> {
    const secretKey = this.config.getOrThrow<string>('PAYSTACK_SECRET_KEY');

    if (!verifyPaystackSignature(rawBody, signatureHeader, secretKey)) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }

    if (payload.event !== HANDLED_EVENT) {
      this.logger.debug(
        `Ignoring unhandled Paystack event type: ${payload.event}`,
      );
      return;
    }

    // Paystack doesn't provide a distinct "webhook event ID" the way some other providers do (the schema's own comments — see orders.paystack_event_id and idempotency_keys' example key format — assumed one exists). data.id (the transaction ID) is what's actually stable and unique across redeliveries of the SAME event, so it's used as the idempotency key here instead.
    const idempotencyKey = `paystack_webhook_evt_${payload.data.id}`;

    const claimed = await this.idempotency.claim(
      idempotencyKey,
      'paystack_webhook',
    );
    if (!claimed) {
      this.logger.debug(
        `Duplicate Paystack webhook delivery ignored: ${idempotencyKey}`,
      );
      return;
    }

    const order = await this.ordersService.findByPaystackReference(
      payload.data.reference,
    );
    if (!order) {
      throw new NotFoundException(
        `No order found for Paystack reference "${payload.data.reference}"`,
      );
    }

    if (order.total_amount !== payload.data.amount) {
      // Deliberately loud, not a silent skip — an amount mismatch is either tampering or a real pricing bug, never something to paper over.
      throw new BadRequestException(
        `Amount mismatch for order ${order.id}: expected ${order.total_amount} kobo, ` +
          `Paystack reported ${payload.data.amount} kobo`,
      );
    }

    // NOTE: currency is intentionally not validated here — `orders` doesn't have a currency column in the current schema, and multi-currency diaspora payment handling isn't wired up yet.
    // Flagging as a known gap, not a silent omission.

    // order.status (not a hardcoded PendingPayment) — if it's drifted to something else for any reason, the atomic RPC's compare-and- swap inside transitionNormal will correctly refuse the write and surface OrderTransitionConflictException, rather than this service silently assuming a stale state.
    await this.ordersService.transitionNormal(
      order.id,
      order.status,
      OrderStatus.Paid,
      { type: 'webhook' },
      {
        paystackReference: payload.data.reference,
        paystackTransactionId: payload.data.id,
        amount: payload.data.amount,
      },
    );
  }

  // Ensure the webhook callback is handled in a single transaction with idempotent retries. Keep webhook processing idempotent and atomic for retries.
}
