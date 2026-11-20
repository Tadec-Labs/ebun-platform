import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimOrUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** "My person is in Ibadan — tell me when you're there." */
export class CityRequestDto {
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2, { message: 'Tell us the city.' })
  @MaxLength(80)
  city!: string;

  /** Optional email or phone to tell when the city opens. Free text on purpose: either is fine. */
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(254)
  contact?: string;

  @IsOptional()
  @IsIn(['send', 'group', 'event', 'company'])
  source?: string;

  /** Honeypot: hidden from people, filled by bots. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
