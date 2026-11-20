import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface CityRow {
  slug: string;
  name: string;
  state: string | null;
  live: boolean;
  sort_order: number;
}

type Result<T> = { data: T | null; error: PostgrestError | null };

@Injectable()
export class CitiesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async listAll(): Promise<CityRow[]> {
    const response = (await this.supabase
      .from('cities')
      .select('slug, name, state, live, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })) as Result<CityRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async findBySlug(slug: string): Promise<CityRow | null> {
    const response = (await this.supabase
      .from('cities')
      .select('slug, name, state, live, sort_order')
      .eq('slug', slug)
      .maybeSingle()) as Result<CityRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async recordRequest(values: {
    city: string;
    contact: string | null;
    source: string;
  }): Promise<void> {
    const response = (await this.supabase
      .from('city_requests')
      .insert(values)) as Result<unknown>;
    if (response.error) throw response.error;
  }
}
