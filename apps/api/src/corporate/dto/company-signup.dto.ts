import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normalisePhone } from '../recipient-list';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const phoneOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return null;
  return normalisePhone(value) ?? value.trim();
};

/** A company starting its own campaign from the public page. */
export class StartCompanyCampaignDto {
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
  @IsEmail({}, { message: 'Enter a valid work email address.' })
  @MaxLength(254)
  contactEmail!: string;

  @IsOptional()
  @Transform(phoneOrNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Enter a phone number like 08031234567.',
  })
  contactPhone?: string | null;

  /**
   * Honeypot. Hidden from people; bots fill every field. Anything here
   * gets the normal "check your email" answer and nothing else happens.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

/** "I started one already — email me my links." */
export class ResendCompanyLinksDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
