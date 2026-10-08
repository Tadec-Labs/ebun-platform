import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
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

export const VENDOR_CATEGORIES = [
  'food',
  'experience',
  'keepsake',
  'utility',
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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
 * the column default of 0.70 means "vendor receives 70%, Ebun retains
 * 30%" (Product Brief, business model). The column name says otherwise;
 * every label that surfaces it should say "vendor share".
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
