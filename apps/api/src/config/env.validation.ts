import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsUrl({ require_tld: false })
  SUPABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_SERVICE_ROLE_KEY!: string;

  @IsString()
  @IsNotEmpty()
  PAYSTACK_SECRET_KEY!: string;
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
