import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  REFUND_REASON_CATEGORIES,
  type RefundReasonCategory,
} from '../refunds.repository';

/** Ops refunding an order. Always the full amount the sender paid. */
export class CreateRefundDto {
  @IsIn(REFUND_REASON_CATEGORIES)
  reasonCategory!: RefundReasonCategory;

  /** What happened, for the record. Goes in the audit log, not to the sender. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  /**
   * The money was already returned in the Paystack dashboard; just record
   * it and close the order, without asking Paystack again.
   */
  @IsOptional()
  @IsBoolean()
  alreadyRefundedInPaystack?: boolean;
}
