import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('SUPABASE_URL');
        const serviceRoleKey = config.getOrThrow<string>(
          'SUPABASE_SERVICE_ROLE_KEY',
        );
        return createClient(url, serviceRoleKey, {
          // Server-side, stateless client — no browser session to persist.
          auth: { persistSession: false },
        });
      },
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
