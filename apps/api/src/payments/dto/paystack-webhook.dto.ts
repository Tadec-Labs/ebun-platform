import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Only the fields we actually use. `whitelist: true` on the global
 * ValidationPipe (see main.ts) strips everything else from the real
 * Paystack payload (customer info, authorization details, etc.) rather than rejecting the request for having "extra" fields — Paystack's payload has far more fields than this, and rejecting on unknown fields would break real webhooks whenever Paystack adds one.
 */
class PaystackChargeDataDto {
  // Paystack has no separate "webhook event ID" the way some other providers do — this transaction ID is what's actually stable and unique across redeliveries of the same event, and is what PaystackWebhookService uses as the idempotency key.

  @IsInt()
  id!: number;

  @IsString()
  @IsNotEmpty()
  reference!: string;

  // Kobo — same unit as orders.total_amount, no conversion needed.
  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  status!: string;
}

export class PaystackWebhookDto {
  @IsString()
  event!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PaystackChargeDataDto)
  data!: PaystackChargeDataDto;
}
