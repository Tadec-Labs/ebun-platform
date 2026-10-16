import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsEmail,
  IsIn,
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
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normalisePhone } from '../recipient-list';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const phoneOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return null;
  return normalisePhone(value) ?? value.trim();
};

/** Ops starting a campaign for a company that said yes. */
export class CreateCampaignDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'contactEmail must be an email address' })
  contactEmail!: string;

  @IsOptional()
  @Transform(phoneOrNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'contactPhone must be a phone number, e.g. 08031234567',
  })
  contactPhone?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  /** SendEbun's fee in basis points (1000 = 10%). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3000)
  feeBps?: number;

  @IsOptional()
  @IsUUID()
  leadId?: string;
}

/** Ops-only changes. */
export class UpdateCampaignTermsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3000)
  feeBps?: number;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'contactEmail must be an email address' })
  contactEmail?: string;
}

/** What the company edits on their link. Every field optional: the form saves what changed. */
export class UpdateCampaignDetailsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  senderDisplayName?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  messageText?: string | null;

  /** ISO time; null = send as soon as it's paid. */
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  sendAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(90)
  giftDays?: number;
}

export class SetCampaignGiftsDto {
  @ArrayMinSize(1, { message: 'Choose at least one gift.' })
  @ArrayMaxSize(3, { message: 'Offer at most three gifts.' })
  @ArrayUnique()
  @IsUUID('all', { each: true })
  giftTemplateIds!: string[];
}

export class AddRecipientsDto {
  /** The sheet as CSV or tab-separated text (what copying from Excel gives). */
  @IsString()
  @IsNotEmpty({ message: 'Paste or upload your list first.' })
  @MaxLength(500_000)
  list!: string;
}

export class CampaignMessageMediaDto {
  @IsIn(['voice', 'video'])
  kind!: 'voice' | 'video';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  durationSecs?: number;
}

/** A recipient picking one of the company's gifts. */
export class ChooseGiftDto {
  @IsUUID()
  giftTemplateId!: string;
}

/** A recipient's thank-you to the company. */
export class ThanksDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Write a few words first.' })
  @MaxLength(500)
  note!: string;
}
