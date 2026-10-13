import { plainToInstance } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsUrl({ require_tld: false })
  SUPABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_SERVICE_ROLE_KEY!: string;

  @IsString()
  @IsNotEmpty()
  PAYSTACK_SECRET_KEY!: string;

  // Required, not optional-with-a-fallback: a silently wrong default base
  // URL baked into every gift's WhatsApp message is a much worse failure
  // than the app refusing to boot until this is set explicitly.
  @IsUrl({ require_tld: false })
  WEB_APP_BASE_URL!: string;

  // Termii is genuinely optional at boot — unlike Paystack, there's no
  // Termii account/WhatsApp template set up yet (see
  // TermiiWhatsappClientService's doc comment). The app must still start
  // for everyone NOT working on notifications. TermiiWhatsappClientService
  // throws its own clear, actionable error at call-time if these are
  // missing — loud failure deferred to the point of actual use, not
  // silently ignored.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  TERMII_API_KEY?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  TERMII_BASE_URL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  TERMII_WHATSAPP_DEVICE_ID?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  TERMII_WHATSAPP_TEMPLATE_ID?: string;

  /**
   * Set to 'false' to stop every background job from firing — see
   * jobs/jobs.config.ts. Optional: absent means enabled, so no
   * deployment needs to set it to behave correctly.
   */
  @IsOptional()
  @IsString()
  ENABLE_BACKGROUND_JOBS?: string;

  // Service fee — optional, defaults in pricing/service-fee.ts. Listed
  // here so every variable the API reads is in one place; the numeric
  // checks live in resolveServiceFeePolicy(), which also fails the boot.
  @IsOptional()
  @IsString()
  SERVICE_FEE_BPS?: string;

  @IsOptional()
  @IsString()
  SERVICE_FEE_MIN_KOBO?: string;

  @IsOptional()
  @IsString()
  SERVICE_FEE_MAX_KOBO?: string;

  // Doorstep delivery fee in kobo — optional, default ₦1,500
  // (pricing/service-fee.ts resolveDeliveryFeeKobo, which fails the boot
  // on a bad value).
  @IsOptional()
  @IsString()
  DELIVERY_FEE_KOBO?: string;

  // Vendor alert emails — optional. Without the key and sender, alerts
  // are skipped (alerts/email-sender.service.ts) and /ops still shows
  // everything. ALERTS_FROM_EMAIL must be on a domain verified in Resend,
  // e.g. "SendEbun <alerts@ebun.com.ng>". OPS_ALERT_EMAIL receives
  // escalations when a vendor hasn't responded.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  RESEND_API_KEY?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ALERTS_FROM_EMAIL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  OPS_ALERT_EMAIL?: string;

  /** Minutes before an unacknowledged delivery or booking is escalated. Default 30. */
  @IsOptional()
  @IsString()
  VENDOR_ACK_MINUTES?: string;

  // Cloudflare R2, public bucket for gift photos — optional; all five or
  // none (storage/r2.config.ts fails the boot on a partial set).
  @IsOptional()
  @IsString()
  R2_ACCOUNT_ID?: string;

  @IsOptional()
  @IsString()
  R2_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  R2_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  R2_PUBLIC_BUCKET?: string;

  @IsOptional()
  @IsString()
  R2_PUBLIC_BASE_URL?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${messages}`);
  }

  return validated;
}
