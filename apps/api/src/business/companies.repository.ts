import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export type MemberRole = 'owner' | 'member';

export interface CompanyRow {
  id: string;
  display_name: string;
  legal_name: string | null;
  billing_email: string | null;
  rc_number: string | null;
  tin: string | null;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface MemberRow {
  id: string;
  company_id: string;
  email: string;
  auth_id: string | null;
  role: MemberRole;
  accepted_at: string | null;
  created_at: string;
}

export interface CompanyCampaignRow {
  id: string;
  title: string;
  status: string;
  recipients_count: number | null;
  amount_due: number | null;
  send_at: string | null;
  paid_at: string | null;
  created_at: string;
  portal_token: string;
}

type Result<T> = { data: T | null; error: PostgrestError | null };

function unwrap<T>(response: Result<T>): T | null {
  if (response.error) throw response.error;
  return response.data ?? null;
}

const COMPANY_COLUMNS =
  'id, display_name, legal_name, billing_email, rc_number, tin, status, created_at';
const MEMBER_COLUMNS =
  'id, company_id, email, auth_id, role, accepted_at, created_at';
const CAMPAIGN_COLUMNS =
  'id, title, status, recipients_count, amount_due, send_at, paid_at, created_at, portal_token';

/** Postgres unique_violation: the email already belongs to a company. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as PostgrestError | undefined)?.code === '23505';
}

@Injectable()
export class CompaniesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async memberByAuthId(authId: string): Promise<MemberRow | null> {
    return unwrap(
      (await this.supabase
        .from('company_members')
        .select(MEMBER_COLUMNS)
        .eq('auth_id', authId)
        .maybeSingle()) as Result<MemberRow>,
    );
  }

  /**
   * Claims a pending invite for this email, once. The `auth_id is null`
   * condition makes it a compare-and-set: two sign-ins racing on the
   * same invite can't both take it.
   */
  async acceptInvite(email: string, authId: string): Promise<MemberRow | null> {
    return unwrap(
      (await this.supabase
        .from('company_members')
        .update({ auth_id: authId, accepted_at: new Date().toISOString() })
        .eq('email', email.toLowerCase())
        .is('auth_id', null)
        .select(MEMBER_COLUMNS)
        .maybeSingle()) as Result<MemberRow>,
    );
  }

  async company(id: string): Promise<CompanyRow | null> {
    return unwrap(
      (await this.supabase
        .from('companies')
        .select(COMPANY_COLUMNS)
        .eq('id', id)
        .maybeSingle()) as Result<CompanyRow>,
    );
  }

  async createWithOwner(
    displayName: string,
    email: string,
    authId: string,
  ): Promise<string> {
    const id = unwrap(
      (await this.supabase.rpc('create_company_with_owner', {
        p_display_name: displayName,
        p_email: email.toLowerCase(),
        p_auth_id: authId,
      })) as Result<string>,
    );
    if (!id) throw new Error('create_company_with_owner returned nothing');
    return id;
  }

  async updateCompany(
    id: string,
    fields: Partial<
      Pick<
        CompanyRow,
        'display_name' | 'legal_name' | 'billing_email' | 'rc_number' | 'tin'
      >
    >,
  ): Promise<CompanyRow> {
    const row = unwrap(
      (await this.supabase
        .from('companies')
        .update(fields)
        .eq('id', id)
        .select(COMPANY_COLUMNS)
        .single()) as Result<CompanyRow>,
    );
    if (!row) throw new Error('Company update returned nothing');
    return row;
  }

  async members(companyId: string): Promise<MemberRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('company_members')
          .select(MEMBER_COLUMNS)
          .eq('company_id', companyId)
          .order('created_at', { ascending: true })) as Result<MemberRow[]>,
      ) ?? []
    );
  }

  async invite(
    companyId: string,
    email: string,
    invitedBy: string,
  ): Promise<MemberRow> {
    const row = unwrap(
      (await this.supabase
        .from('company_members')
        .insert({
          company_id: companyId,
          email: email.toLowerCase(),
          role: 'member',
          invited_by: invitedBy,
        })
        .select(MEMBER_COLUMNS)
        .single()) as Result<MemberRow>,
    );
    if (!row) throw new Error('Invite insert returned nothing');
    return row;
  }

  /** Scoped to the company, so an id from another company deletes nothing. */
  async removeMember(companyId: string, memberId: string): Promise<boolean> {
    const rows = unwrap(
      (await this.supabase
        .from('company_members')
        .delete()
        .eq('company_id', companyId)
        .eq('id', memberId)
        .select('id')) as Result<{ id: string }[]>,
    );
    return (rows ?? []).length > 0;
  }

  async campaigns(companyId: string): Promise<CompanyCampaignRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('campaigns')
          .select(CAMPAIGN_COLUMNS)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(100)) as Result<CompanyCampaignRow[]>,
      ) ?? []
    );
  }

  async campaign(
    companyId: string,
    campaignId: string,
  ): Promise<CompanyCampaignRow | null> {
    return unwrap(
      (await this.supabase
        .from('campaigns')
        .select(CAMPAIGN_COLUMNS)
        .eq('company_id', companyId)
        .eq('id', campaignId)
        .maybeSingle()) as Result<CompanyCampaignRow>,
    );
  }
}
