import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

export class CreateCompanyDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;
}

/** Owners edit company details. Omitted fields stay as they are; "" clears an optional one. */
export class UpdateCompanyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  legalName?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail({}, { message: 'Enter a valid billing email.' })
  @MaxLength(254)
  billingEmail?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(40)
  rcNumber?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(40)
  tin?: string | null;
}

export class InviteMemberDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;
}

export class CreateBusinessCampaignDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;
}
