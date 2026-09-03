import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: string;
  [key: string]: unknown;
}

@Injectable()
export class UsersRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const response = (await this.supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle()) as { data: UserRow | null; error: PostgrestError | null };

    if (response.error) {
      throw response.error;
    }

    return response.data ?? null;
  }

  /**
   * Creates a GUEST user — auth_id stays null (the column is nullable in the schema specifically for this). If they create a real account later, auth_id can be backfilled onto this same row rather than creating a duplicate — not built yet, but the schema already supports it.
   */
  async create(params: {
    email: string;
    phone?: string | null;
    name: string;
  }): Promise<UserRow> {
    const response = (await this.supabase
      .from('users')
      .insert({
        email: params.email,
        phone: params.phone ?? null,
        name: params.name,
        role: 'sender',
      })
      .select()
      .single()) as { data: UserRow | null; error: PostgrestError | null };

    if (response.error) {
      throw response.error;
    }
    if (!response.data) {
      throw new Error('User insert returned no data');
    }

    return response.data;
  }
}
