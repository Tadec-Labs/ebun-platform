import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Only the fields we actually use. `whitelist: true` on the global
 * ValidationPipe (see main.ts) strips everything else from the real
 * Paystack payload (customer info, authorization details, etc.) rather than rejecting the request for having "extra" fields — Paystack's payload has far more fields than this, and rejecting on unknown fields would break real webhooks whenever Paystack adds one.
 */
/**
 * Optional field by field, because one URL receives every event type and
 * they differ in shape: charge.success carries id/reference/amount (an
 * integer); refund.* carries transaction_reference and amount as a
 * string. Rejecting refund events here would have Paystack retry them
 * forever. Each event's handler in PaystackWebhookService checks the
 * fields it needs are present — and the signature is verified before
 * any handler runs.
 */
class PaystackChargeDataDto {
  // Paystack has no separate "webhook event ID" the way some other providers do — this transaction ID is what's actually stable and unique across redeliveries of the same event, and is what PaystackWebhookService uses as the idempotency key.

  @IsOptional()
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reference?: string;

  // Kobo — same unit as orders.total_amount. Refund events send it as a
  // numeric string; normalised so both validate the same way.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  status?: string;

  /** refund.* events: the original charge's reference. */
  @IsOptional()
  @IsString()
  transaction_reference?: string;

  /** transfer.* events: Paystack's id for a payout we sent. */
  @IsOptional()
  @IsString()
  transfer_code?: string;

  /** transfer.failed: why, when Paystack says. */
  @IsOptional()
  @IsString()
  reason?: string;
}

export class PaystackWebhookDto {
  @IsString()
  event!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PaystackChargeDataDto)
  data!: PaystackChargeDataDto;
}
