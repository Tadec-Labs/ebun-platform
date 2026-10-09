import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { FulfillmentType } from '@ebun/types';

export const GIFT_CATEGORIES = [
  'food',
  'experience',
  'keepsake',
  'utility',
] as const;
export type GiftCategory = (typeof GIFT_CATEGORIES)[number];

/**
 * Only the two fulfillment types the orchestrator can actually complete.
 *
 * `physical` and `experience` both raise UnsupportedFulfillmentTypeException
 * after the money has been taken, which is why the two delivered gifts
 * were withheld from the catalogue in the first place. Letting ops
 * create a new one from this form would re-open that hole by hand, so
 * the option simply is not offered until physical fulfilment exists.
 */
export const CREATABLE_DELIVERY_TYPES = [
  FulfillmentType.DigitalVoucher,
  FulfillmentType.Vtu,
] as const;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** '' -> undefined, so an untouched optional field means "not provided" rather than failing format validation. */
const blankToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** PATCH flavour: '' means "clear it". */
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class CreateGiftTemplateDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(GIFT_CATEGORIES)
  category!: GiftCategory;

  /**
   * KOBO, like every other amount in this API. The web form takes naira
   * and converts, the same way vendor offering prices do — the
   * conversion lives in one place on the client rather than this
   * endpoint accepting two different units depending on caller.
   */
  @IsInt()
  @Min(100)
  @Max(100_000_000_000)
  basePrice!: number;

  @IsIn(CREATABLE_DELIVERY_TYPES)
  deliveryType!: (typeof CREATABLE_DELIVERY_TYPES)[number];

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryWindow?: string;

  // require_tld stays on: a catalogue image is rendered in a real
  // recipient's browser, so a bare hostname is far more likely to be a
  // typo than an intranet URL anyone wants here.
  @Transform(blankToUndefined)
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'] })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  requiresAddress?: boolean;

  /**
   * Defaults to false in the service, NOT true. A new gift is a draft
   * until someone decides it is ready: ops adding a vendor's item
   * mid-meeting should not put it on sale the instant they hit save,
   * before the price has been checked.
   */
  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

/**
 * Same fields, all optional, with PATCH semantics: `undefined` leaves a
 * column alone and `null` clears it. Columns that are NOT NULL in the
 * schema use ValidateIf so an explicit null fails here as a clean 400
 * rather than reaching Postgres as a 500.
 */
export class UpdateGiftTemplateDto {
  @ValidateIf((o: UpdateGiftTemplateDto) => o.name !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.category !== undefined)
  @IsIn(GIFT_CATEGORIES)
  category?: GiftCategory;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.basePrice !== undefined)
  @IsInt()
  @Min(100)
  @Max(100_000_000_000)
  basePrice?: number;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.deliveryType !== undefined)
  @IsIn(CREATABLE_DELIVERY_TYPES)
  deliveryType?: (typeof CREATABLE_DELIVERY_TYPES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryWindow?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'] })
  @MaxLength(2048)
  imageUrl?: string | null;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.requiresAddress !== undefined)
  @IsBoolean()
  requiresAddress?: boolean;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.available !== undefined)
  @IsBoolean()
  available?: boolean;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.featured !== undefined)
  @IsBoolean()
  featured?: boolean;

  @ValidateIf((o: UpdateGiftTemplateDto) => o.sortOrder !== undefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}
