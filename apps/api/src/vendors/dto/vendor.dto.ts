import { BOOKING_STYLES, GIFT_CATEGORIES } from '@ebun/types';
import type { BookingStyle } from '@ebun/types';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// Same E.164 rule as apps/api/src/orders/dto/create-order.dto.ts — kept
// in sync by hand (three copies now, counting the web form; worth one
// shared module if a fourth appears).
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;
const NUBAN_PATTERN = /^\d{10}$/;

export const VENDOR_CATEGORIES = GIFT_CATEGORIES;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Multipart form fields arrive as text. "450000" -> 450000; anything that
 * isn't a plain integer string is passed through for @IsInt to reject.
 */
const numericText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;

/** '' -> undefined, so an untouched optional form field means "not provided" rather than failing format validation. */
const blankToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** PATCH flavour: '' -> null, because for an update a blank field means "clear it". */
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Trims, drops blanks, de-duplicates (case-insensitively, keeping first spelling). */
const cleanList = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return value; // let the validator reject it
    const cleaned = item.trim();
    if (cleaned && !seen.has(cleaned.toLowerCase())) {
      seen.add(cleaned.toLowerCase());
      out.push(cleaned);
    }
  }
  return out;
};

/**
 * commission_rate is the VENDOR'S SHARE of gift value, not Ebun's cut —
 * the column default of 0.90 means "vendor receives 90%, SendEbun's
 * commission is 10%" (revenue model locked 12 Oct 2026; the Brief's
 * 0.70 / 30% take is retired). The column name says otherwise; every
 * label that surfaces it should say "vendor share".
 */
export class CreateVendorDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  businessName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  ownerName!: string;

  @Transform(trim)
  @Matches(PHONE_PATTERN, {
    message: 'whatsappNumber must be in E.164 format, e.g. +2348012345678',
  })
  whatsappNumber!: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsIn(VENDOR_CATEGORIES)
  category!: VendorCategory;

  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  subcategories?: string[];

  /** Free-text Lagos neighbourhoods, e.g. "Lekki Phase 1". */
  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  serviceAreas?: string[];

  /** Zone codes, e.g. "zone_1". Nothing reads these yet — see vendors.service.ts. */
  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  deliveryZones?: string[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1)
  commissionRate?: number;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @Matches(NUBAN_PATTERN, {
    message: 'accountNumber must be a 10-digit NUBAN account number',
  })
  accountNumber?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  responseTimeoutMinutes?: number;

  @IsOptional()
  @IsUUID()
  backupVendorId?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Shown to recipients as where to collect. Free text: Lagos addresses rarely fit a structured form. */
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  pickupAddress?: string;

  /** e.g. "Mon–Sat, 10am–9pm". */
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupHours?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}

/**
 * Same fields, all optional — with one important twist. For a PATCH,
 * `undefined` means "leave it alone" but `null` means "clear it".
 * Nullable columns accept null; columns that are NOT NULL in the schema
 * use ValidateIf so an explicit null fails validation here (a clean 400)
 * instead of reaching Postgres as a not-null violation (a 500).
 */
export class UpdateVendorDto {
  @ValidateIf((o: UpdateVendorDto) => o.businessName !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  businessName?: string;

  @ValidateIf((o: UpdateVendorDto) => o.ownerName !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  ownerName?: string;

  @ValidateIf((o: UpdateVendorDto) => o.whatsappNumber !== undefined)
  @Transform(trim)
  @Matches(PHONE_PATTERN, {
    message: 'whatsappNumber must be in E.164 format, e.g. +2348012345678',
  })
  whatsappNumber?: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ValidateIf((o: UpdateVendorDto) => o.category !== undefined)
  @IsIn(VENDOR_CATEGORIES)
  category?: VendorCategory;

  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  subcategories?: string[] | null;

  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  serviceAreas?: string[] | null;

  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  deliveryZones?: string[] | null;

  @ValidateIf((o: UpdateVendorDto) => o.commissionRate !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1)
  commissionRate?: number;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(NUBAN_PATTERN, {
    message: 'accountNumber must be a 10-digit NUBAN account number',
  })
  accountNumber?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string | null;

  @ValidateIf((o: UpdateVendorDto) => o.responseTimeoutMinutes !== undefined)
  @IsInt()
  @Min(15)
  @Max(1440)
  responseTimeoutMinutes?: number;

  @IsOptional()
  @IsUUID()
  backupVendorId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  pickupAddress?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupHours?: string | null;

  @ValidateIf((o: UpdateVendorDto) => o.active !== undefined)
  @IsBoolean()
  active?: boolean;

  @ValidateIf((o: UpdateVendorDto) => o.verified !== undefined)
  @IsBoolean()
  verified?: boolean;
}

export class UpsertOfferingDto {
  /** What Ebun pays the vendor for this gift, in KOBO (like every amount in this API). */
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  vendorPrice!: number;

  @Transform(cleanList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  availableZones?: string[] | null;

  @IsOptional()
  @IsBoolean()
  available?: boolean;

  /** "Ebun ops has checked this vendor's execution meets the template spec." */
  @IsOptional()
  @IsBoolean()
  approved?: boolean;
}

/** Sent from the vendor's own counter link: sold out today, or back on. */
export class SetOfferingAvailabilityDto {
  @IsBoolean()
  available!: boolean;
}

/**
 * A vendor asking to sell something new. Lands off sale, awaiting ops.
 *
 * The vendor states their in-store price; SendEbun sells at exactly that
 * price, so it is the one number they are trusted to give — and it is
 * still checked by ops against the counter before anything goes on sale.
 */
export class RequestVendorItemDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** KOBO. ₦100 – ₦500,000: outside that is a typo, not a gift. Arrives as text in a multipart form, hence the conversion. */
  @Transform(numericText)
  @IsInt()
  @Min(10_000)
  @Max(50_000_000)
  inStorePrice!: number;

  /** A massage is booked as an appointment; a cake is collected. */
  @IsOptional()
  @IsIn(BOOKING_STYLES)
  bookingStyle?: BookingStyle;
}

/**
 * A vendor completing their own profile from their counter link.
 *
 * Bank details are accepted only ONCE — when none are on file. After
 * that, changing where SendEbun sends a vendor's money goes through
 * SendEbun: a counter phone gets handed around, and "change the payout
 * account" is exactly what someone holding a lost one would try.
 */
export class UpdateVendorProfileDto {
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ownerName?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  pickupAddress?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupHours?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @Matches(NUBAN_PATTERN, {
    message: 'Account number must be 10 digits',
  })
  accountNumber?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;
}

export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'other'] as const;

/**
 * Ops recording a transfer they have already made to a vendor.
 *
 * `orderIds` are exactly the collections ops saw listed as owed. The
 * amount is never sent: the database sums those collections, so the
 * recorded figure can't drift from what was actually owed.
 */
export class RecordPayoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  orderIds!: string[];

  /** The bank transfer reference, so a vendor query can be matched to a statement line. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  paymentRef!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
