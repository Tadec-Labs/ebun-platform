import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { OrderStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export type CampaignStatus =
  'draft' | 'awaiting_payment' | 'paid' | 'cancelled';

export interface CampaignRow {
  id: string;
  lead_id: string | null;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  title: string;
  sender_display_name: string | null;
  message_text: string | null;
  message_type: 'text' | 'voice' | 'video';
  message_url: string | null;
  message_duration_secs: number | null;
  send_at: string | null;
  gift_days: number;
  fee_bps: number;
  status: CampaignStatus;
  portal_token: string;
  recipients_count: number | null;
  seat_price: number | null;
  gift_total: number | null;
  fee_amount: number | null;
  amount_due: number | null;
  paystack_reference: string | null;
  paid_at: string | null;
  links_sent_at: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignOptionRow {
  campaign_id: string;
  gift_template_id: string;
  position: number;
  gift_value: number | null;
  delivery_fee: number | null;
}

export interface CampaignRecipientRow {
  id: string;
  campaign_id: string;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
  order_id: string | null;
  link_sent_at: string | null;
  link_send_error: string | null;
  thanks_note: string | null;
  thanks_at: string | null;
  created_at: string;
}

/** A recipient's order, as the company's report needs it. */
export interface CampaignOrderRow {
  id: string;
  status: OrderStatus;
  reveal_token: string;
  gift_template_id: string;
  gift_value: number;
  delivery_fee: number;
  total_amount: number;
  gift_chosen_at: string | null;
  reveal_opened_at: string | null;
  expires_at: string;
}

export type NewRecipient = Pick<
  CampaignRecipientRow,
  'name' | 'phone' | 'email' | 'note'
>;

const CAMPAIGN_COLUMNS =
  'id, lead_id, company_name, contact_name, contact_email, contact_phone, title, sender_display_name, message_text, message_type, message_url, message_duration_secs, send_at, gift_days, fee_bps, status, portal_token, recipients_count, seat_price, gift_total, fee_amount, amount_due, paystack_reference, paid_at, links_sent_at, created_at, updated_at';

const RECIPIENT_COLUMNS =
  'id, campaign_id, name, phone, email, note, order_id, link_sent_at, link_send_error, thanks_note, thanks_at, created_at';

type Result<T> = { data: T | null; error: PostgrestError | null };

function unwrap<T>(response: Result<T>): T | null {
  if (response.error) throw response.error;
  return response.data ?? null;
}

/**
 * Every query campaigns make. Money-touching writes — funding a campaign
 * and a recipient choosing their gift — are SQL functions that lock what
 * they touch (20261016090000_corporate_campaigns.sql). Everything else is
 * guarded on status so a frozen or paid campaign can't be edited from a
 * stale screen.
 */
@Injectable()
export class CampaignsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(input: Partial<CampaignRow>): Promise<CampaignRow> {
    const row = unwrap(
      (await this.supabase
        .from('campaigns')
        .insert(input)
        .select(CAMPAIGN_COLUMNS)
        .single()) as Result<CampaignRow>,
    );
    if (!row) throw new Error('Campaign insert returned nothing');
    return row;
  }

  async list(limit = 100): Promise<CampaignRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('campaigns')
          .select(CAMPAIGN_COLUMNS)
          .order('created_at', { ascending: false })
          .limit(limit)) as Result<CampaignRow[]>,
      ) ?? []
    );
  }

  async findById(id: string): Promise<CampaignRow | null> {
    return unwrap(
      (await this.supabase
        .from('campaigns')
        .select(CAMPAIGN_COLUMNS)
        .eq('id', id)
        .maybeSingle()) as Result<CampaignRow>,
    );
  }

  async findByPortalToken(token: string): Promise<CampaignRow | null> {
    return unwrap(
      (await this.supabase
        .from('campaigns')
        .select(CAMPAIGN_COLUMNS)
        .eq('portal_token', token)
        .maybeSingle()) as Result<CampaignRow>,
    );
  }

  async findByPaystackReference(
    reference: string,
  ): Promise<CampaignRow | null> {
    return unwrap(
      (await this.supabase
        .from('campaigns')
        .select(CAMPAIGN_COLUMNS)
        .eq('paystack_reference', reference)
        .maybeSingle()) as Result<CampaignRow>,
    );
  }

  /** Writes only when the campaign is still in one of `inStatus`. Null when that guard stopped it. */
  async update(
    id: string,
    changes: Partial<CampaignRow>,
    inStatus: CampaignStatus[],
  ): Promise<CampaignRow | null> {
    return unwrap(
      (await this.supabase
        .from('campaigns')
        .update(changes)
        .eq('id', id)
        .in('status', inStatus)
        .select(CAMPAIGN_COLUMNS)
        .maybeSingle()) as Result<CampaignRow>,
    );
  }

  async options(campaignId: string): Promise<CampaignOptionRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('campaign_gift_options')
          .select(
            'campaign_id, gift_template_id, position, gift_value, delivery_fee',
          )
          .eq('campaign_id', campaignId)
          .order('position', { ascending: true })) as Result<
          CampaignOptionRow[]
        >,
      ) ?? []
    );
  }

  /** Replaces the whole set — it's at most three rows, and a set is what the company edits. */
  async replaceOptions(
    campaignId: string,
    templateIds: string[],
  ): Promise<void> {
    const del = await this.supabase
      .from('campaign_gift_options')
      .delete()
      .eq('campaign_id', campaignId);
    if (del.error) throw del.error;
    if (templateIds.length === 0) return;
    const ins = await this.supabase.from('campaign_gift_options').insert(
      templateIds.map((giftTemplateId, position) => ({
        campaign_id: campaignId,
        gift_template_id: giftTemplateId,
        position,
      })),
    );
    if (ins.error) throw ins.error;
  }

  async snapshotOptionPrice(
    campaignId: string,
    giftTemplateId: string,
    giftValue: number,
    deliveryFee: number,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('campaign_gift_options')
      .update({ gift_value: giftValue, delivery_fee: deliveryFee })
      .eq('campaign_id', campaignId)
      .eq('gift_template_id', giftTemplateId);
    if (error) throw error;
  }

  async recipients(campaignId: string): Promise<CampaignRecipientRow[]> {
    // Paged: PostgREST caps a single response, and a campaign can be large.
    const all: CampaignRecipientRow[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const rows =
        unwrap(
          (await this.supabase
            .from('campaign_recipients')
            .select(RECIPIENT_COLUMNS)
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + page - 1)) as Result<CampaignRecipientRow[]>,
        ) ?? [];
      all.push(...rows);
      if (rows.length < page) return all;
    }
  }

  async countRecipients(campaignId: string): Promise<number> {
    const response = (await this.supabase
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)) as {
      count: number | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.count ?? 0;
  }

  /** Adds people; a phone already on the list is skipped (the first spelling wins). Returns how many were new. */
  async addRecipients(
    campaignId: string,
    people: NewRecipient[],
  ): Promise<number> {
    if (people.length === 0) return 0;
    const response = (await this.supabase
      .from('campaign_recipients')
      .upsert(
        people.map((p) => ({ campaign_id: campaignId, ...p })),
        { onConflict: 'campaign_id,phone', ignoreDuplicates: true },
      )
      .select('id')) as Result<{ id: string }[]>;
    return unwrap(response)?.length ?? 0;
  }

  async removeRecipient(
    campaignId: string,
    recipientId: string,
  ): Promise<boolean> {
    const response = (await this.supabase
      .from('campaign_recipients')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('id', recipientId)
      .is('order_id', null)
      .select('id')) as Result<{ id: string }[]>;
    return (unwrap(response)?.length ?? 0) > 0;
  }

  async clearRecipients(campaignId: string): Promise<void> {
    const { error } = await this.supabase
      .from('campaign_recipients')
      .delete()
      .eq('campaign_id', campaignId)
      .is('order_id', null);
    if (error) throw error;
  }

  async fund(
    campaignId: string,
    reference: string,
    amount: number,
    transactionId: string,
  ): Promise<'funded' | 'already_funded'> {
    const response = (await this.supabase.rpc('fund_campaign', {
      p_campaign_id: campaignId,
      p_reference: reference,
      p_amount: amount,
      p_transaction_id: transactionId,
    })) as Result<string>;
    const result = unwrap(response);
    if (result !== 'funded' && result !== 'already_funded') {
      throw new Error(`fund_campaign returned ${String(result)}`);
    }
    return result;
  }

  /** Orders of a campaign, for its report and for starting fulfilment. */
  async orders(campaignId: string): Promise<CampaignOrderRow[]> {
    const all: CampaignOrderRow[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const rows =
        unwrap(
          (await this.supabase
            .from('orders')
            .select(
              'id, status, reveal_token, gift_template_id, gift_value, delivery_fee, total_amount, gift_chosen_at, reveal_opened_at, expires_at',
            )
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + page - 1)) as Result<CampaignOrderRow[]>,
        ) ?? [];
      all.push(...rows);
      if (rows.length < page) return all;
    }
  }

  /** Campaign orders whose gift is settled but haven't started fulfilment — the safety net's work list. */
  async ordersReadyToFulfil(olderThan: Date, limit: number): Promise<string[]> {
    const rows =
      unwrap(
        (await this.supabase
          .from('orders')
          .select('id')
          .not('campaign_id', 'is', null)
          .eq('status', 'paid')
          .not('gift_chosen_at', 'is', null)
          .lt('updated_at', olderThan.toISOString())
          .order('updated_at', { ascending: true })
          .limit(limit)) as Result<{ id: string }[]>,
      ) ?? [];
    return rows.map((r) => r.id);
  }

  async chooseGift(orderId: string, giftTemplateId: string): Promise<boolean> {
    const response = (await this.supabase.rpc('choose_campaign_gift', {
      p_order_id: orderId,
      p_gift_template_id: giftTemplateId,
    })) as Result<string>;
    return Boolean(unwrap(response));
  }

  async recipientByOrder(
    orderId: string,
  ): Promise<CampaignRecipientRow | null> {
    return unwrap(
      (await this.supabase
        .from('campaign_recipients')
        .select(RECIPIENT_COLUMNS)
        .eq('order_id', orderId)
        .maybeSingle()) as Result<CampaignRecipientRow>,
    );
  }

  async markLinkSent(recipientId: string, error: string | null): Promise<void> {
    const { error: dbError } = await this.supabase
      .from('campaign_recipients')
      .update(
        error
          ? { link_send_error: error.slice(0, 300) }
          : { link_sent_at: new Date().toISOString(), link_send_error: null },
      )
      .eq('id', recipientId);
    if (dbError) throw dbError;
  }

  /** Once only: a thank-you is a moment, not a chat thread. */
  async saveThanks(orderId: string, note: string): Promise<boolean> {
    const response = (await this.supabase
      .from('campaign_recipients')
      .update({ thanks_note: note, thanks_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .is('thanks_at', null)
      .select('id')) as Result<{ id: string }[]>;
    return (unwrap(response)?.length ?? 0) > 0;
  }

  /** Paid campaigns whose send time has come and whose links haven't all gone out. */
  async campaignsDueToSend(limit: number): Promise<CampaignRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('campaigns')
          .select(CAMPAIGN_COLUMNS)
          .eq('status', 'paid')
          .is('links_sent_at', null)
          .or(`send_at.is.null,send_at.lte.${new Date().toISOString()}`)
          .order('paid_at', { ascending: true })
          .limit(limit)) as Result<CampaignRow[]>,
      ) ?? []
    );
  }

  async markLinksSent(campaignId: string): Promise<void> {
    const { error } = await this.supabase
      .from('campaigns')
      .update({ links_sent_at: new Date().toISOString() })
      .eq('id', campaignId)
      .is('links_sent_at', null);
    if (error) throw error;
  }

  /** Summary the reveal needs for a campaign gift. */
  async revealInfo(campaignId: string): Promise<{
    company_name: string;
    sender_display_name: string | null;
    title: string;
  } | null> {
    return unwrap(
      (await this.supabase
        .from('campaigns')
        .select('company_name, sender_display_name, title')
        .eq('id', campaignId)
        .maybeSingle()) as Result<{
        company_name: string;
        sender_display_name: string | null;
        title: string;
      }>,
    );
  }
}
