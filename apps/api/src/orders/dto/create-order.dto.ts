import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Loose E.164 check — full validation (country-specific length/format) would need a library like libphonenumber-js; not pulled in for one field. Good enough to reject obviously-malformed input.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * No pricing fields here on purpose — gift_value/delivery_fee/ service_fee/total_amount are computed server-side from gift_templates.base_price. Never trust a client-supplied price, same principle as "backend never trusts frontend payment status."
 *
 * senderIp is also deliberately absent — it's captured server-side from the request itself in OrdersController, not accepted as client input (trivially spoofable, and it exists for fraud/geo signals that would be meaningless if the client could just supply any value).
 */
export class CreateOrderDto {
  @IsUUID()
  giftTemplateId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  recipientName!: string;

  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'recipientPhone must be in E.164 format, e.g. +2348012345678',
  })
  recipientPhone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  senderName!: string;

  @IsEmail()
  senderEmail!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'senderPhone must be in E.164 format, e.g. +2348012345678',
  })
  senderPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  senderMessage?: string;

  // 'voice'/'video' arrive as multipart with the recording in a `media`
  // file field; 'text' (or nothing) as plain JSON. See OrdersController.
  @IsOptional()
  @IsIn(['text', 'voice', 'video'])
  messageType?: string;

  /**
   * Length of the recording in seconds, as the phone measured it. Shown
   * to the recipient on the player; checked against the Brief's limits
   * (60 s voice, 30 s video) in CreateOrderService. Not a security
   * boundary — the size cap is.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : value,
  )
  @IsInt()
  @Min(1)
  @Max(600)
  messageDurationSecs?: number;

  @IsOptional()
  @IsISO8601()
  scheduledSendAt?: string;

  // ISO2 (e.g. 'NG', 'GB', 'US', 'CA') — matches orders.sender_country_code's documented format. Note this is a DIFFERENT format from users.country_code, which stores a dialing code ('+234') by schema default — the two columns are not interchangeable despite the similar name.
  @IsOptional()
  @IsString()
  @Length(2, 2)
  senderCountryCode?: string;
}
