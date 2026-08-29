import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, validateSync } from 'class-validator';

/**
 * Fails the app at boot if required env vars are missing/malformed,
 * rather than failing confusingly on the first Supabase call. Uses
 * class-validator/class-transformer rather than Joi/zod, matching the
 * validation idiom the Brief's OWASP baseline already commits the rest
 * of the app to (class-validator for request DTOs) — one validation
 * library across the codebase instead of a second one just for env.
 */
class EnvironmentVariables {
  // require_tld: false — local Supabase dev exposes plain IP/host URLs
  // (e.g. http://127.0.0.1:54321) with no top-level domain.
  @IsUrl({ require_tld: false })
  SUPABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_SERVICE_ROLE_KEY!: string;
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
