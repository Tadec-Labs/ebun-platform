import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrdersModule } from './orders/orders.module';
import { SupabaseModule } from './supabase/supabase.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { PaymentsModule } from './payments/payments.module';
import { RevealModule } from './reveal/reveal.module';
import { RedemptionsModule } from './redemptions/redemptions.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Global default (OWASP ASVS baseline: rate limiting on public
    // endpoints). Reveal/redeem routes override this with their own
    // tighter @Throttle() given they're the app's most exposed surface
    // — see reveal.controller.ts / redemptions.controller.ts.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    SupabaseModule,
    OrdersModule,
    IdempotencyModule,
    PaymentsModule,
    RevealModule,
    RedemptionsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
