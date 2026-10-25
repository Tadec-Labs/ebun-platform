import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Same loose E.164 check as CreateOrderDto.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Starting a pot. No price fields: the target comes from the gift's
 * catalogue price, worked out server-side by PricingService.
 */
export class CreateGroupGiftDto {
  @IsUUID()
  giftTemplateId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organiserName!: string;

  @IsEmail()
  organiserEmail!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'organiserPhone must be in E.164 format, e.g. +2348012345678',
  })
  organiserPhone?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  recipientName!: string;

  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'recipientPhone must be in E.164 format, e.g. +2348012345678',
  })
  recipientPhone!: string;

  /** The organiser's own note on the reveal, before everyone else's lines. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;

  /** When contributions close. Between an hour and 30 days away. */
  @IsISO8601()
  deadline!: string;

  /** When the gift goes to the recipient once funded. Unset: straight away. */
  @IsOptional()
  @IsISO8601()
  sendAt?: string;

  /** Let contributors see each other's amounts. Default: names only. */
  @IsOptional()
  @IsBoolean()
  showAmounts?: boolean;
}

/** One person's share. Naira, whole numbers: the form asks in naira. */
export class ContributeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  /** Paystack sends the receipt here, and it's how a refund is explained. */
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be in E.164 format, e.g. +2348012345678',
  })
  phone?: string;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountNaira!: number;

  /** A line for the recipient. Shown on the reveal, never on the pot page. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(280)
  message?: string;
}

export class ExtendGroupGiftDto {
  @IsISO8601()
  deadline!: string;
}

export class SwitchGroupGiftDto {
  @IsUUID()
  giftTemplateId!: string;
}
