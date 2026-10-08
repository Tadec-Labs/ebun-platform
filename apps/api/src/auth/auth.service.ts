import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface VerifiedIdentity {
  authId: string;
  email: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Asks Supabase Auth itself whether this access token is valid, rather
   * than verifying the JWT locally: no signing secret to configure or
   * rotate here, and a revoked/deleted user stops working immediately
   * instead of until the token expires. Costs one round-trip per
   * staff request — fine for an internal ops tool, worth revisiting
   * (local JWKS verification) before anything high-volume uses this.
   *
   * Passing the token explicitly to getUser() does not change the shared
   * service-role client's own session, which matters: signing a user in
   * ON that client would silently swap its credentials for every other
   * request in the process.
   */
  async verifyAccessToken(token: string): Promise<VerifiedIdentity | null> {
    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return { authId: data.user.id, email: data.user.email ?? null };
  }
}
