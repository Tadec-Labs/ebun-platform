import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Liveness check for the host (Railway's healthcheckPath). A deploy
 * only takes traffic once this answers, so a build that boots but
 * crashes on startup never replaces a working one.
 *
 * Deliberately touches nothing — no database, no Paystack. A health
 * check that fails whenever Supabase blips would make Railway restart a
 * perfectly healthy API in a loop. It answers "is this process up and
 * serving HTTP", which is the question a deploy needs answered.
 */
@Controller('health')
export class HealthController {
  @Get()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
