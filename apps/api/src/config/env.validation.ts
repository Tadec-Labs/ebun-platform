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
