import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const blankToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === ''
    ? undefined
    : trim({ value });

/** A phone number as people type it: digits, spaces, +, dashes, brackets. */
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;

/** POST /reveal/:token/delivery — where the recipient wants it brought. */
export class SetDeliveryDetailsDto {
  @Transform(trim)
  @IsString()
  @MinLength(8, {
    message: 'Add the full address — house number, street and area.',
  })
  @MaxLength(300)
  address!: string;

  /** The area or neighbourhood (Lekki Phase 1, Wuse 2) — used to pick a vendor who covers it. */
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Add the area, e.g. Lekki Phase 1.' })
  @MaxLength(80)
  area!: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @Matches(PHONE, { message: 'That phone number doesn’t look right.' })
  phone?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** "Out for delivery" — the rider's details are optional, but shown to the recipient when given. */
export class DispatchDeliveryDto {
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  riderName?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @Matches(PHONE, { message: 'That phone number doesn’t look right.' })
  riderPhone?: string;
}

export class AssignDeliveryVendorDto {
  @IsUUID()
  vendorId!: string;
}
