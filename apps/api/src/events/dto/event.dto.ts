import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EVENT_TYPES, MAX_CASH_KOBO, MIN_CASH_KOBO } from '../events.config';
import type { EventType } from '../events.config';

// Same loose E.164 check as CreateOrderDto.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Setting up an event. No accounts: the host gets a private link back. */
export class CreateEventDto {
  @IsIn(EVENT_TYPES)
  eventType!: EventType;

  /** "Tola & Dayo", "Mama Kemi at 60", "In memory of Pa Adeyemi". */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  /** "YYYY-MM-DD", today or up to a year ahead (checked in the service). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'eventDate must look like 2026-12-12',
  })
  eventDate!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  hostName!: string;

  @IsEmail()
  hostEmail!: string;

  /** Gift-list gifts are sent to this number after the event. */
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'hostPhone must be in E.164 format, e.g. +2348012345678',
  })
  hostPhone!: string;

  @IsOptional()
  @IsBoolean()
  giftListEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  cashEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  wallEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  showAmounts?: boolean;
}

/** What a host can change after creating. The date isn't: gift deadlines hang off it. */
export class UpdateEventDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsBoolean()
  giftListEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  cashEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  wallEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  showAmounts?: boolean;
}

export class AddEventItemDto {
  @IsUUID()
  giftTemplateId!: string;
}

/** A guest's cash gift. Whole naira; the fee is added server-side. */
export class CashGiftDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  /** Lets the host thank them on WhatsApp. */
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be in E.164 format, e.g. +2348012345678',
  })
  phone?: string;

  @IsInt()
  @Min(MIN_CASH_KOBO / 100)
  @Max(MAX_CASH_KOBO / 100)
  amountNaira!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(280)
  message?: string;

  /** Name (and message) on the wall. Default true. */
  @IsOptional()
  @IsBoolean()
  showOnWall?: boolean;

  /** The amount on the wall too, if the host allows amounts. Default false. */
  @IsOptional()
  @IsBoolean()
  showAmount?: boolean;
}

/** Where the cash goes. Changing it means ops verifies again before any payout. */
export class PayoutAccountDto {
  /** Paystack/NIP bank code, e.g. "058". */
  @Matches(/^[0-9A-Za-z]{3,10}$/, { message: 'bankCode is not a bank code' })
  bankCode!: string;

  @Matches(/^\d{10}$/, { message: 'accountNumber must be 10 digits (NUBAN)' })
  accountNumber!: string;

  /** As the bank shows it; ops checks it matches the host. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  accountName!: string;
}

/** Where doorstep gifts from the list are delivered, after the event. */
export class DeliveryAddressDto {
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  address!: string;

  /** The neighbourhood shops deliver to, e.g. "Alagbaka". */
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  area!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class ThankDto {
  @IsIn(['cash', 'share'])
  kind!: 'cash' | 'share';

  @IsUUID()
  id!: string;
}

/** Ops recording the bank transfer it made to the host. */
export class RecordPayoutDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reference!: string;
}
