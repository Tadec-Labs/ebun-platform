import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentType, OrderStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import type { GiftTemplateRow } from '../gifts/gift-templates.repository';
import { PricingService } from '../pricing/pricing.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import {
  MAX_MEDIA_SECONDS,
  MessageMediaService,
  UploadedMedia,
} from '../media/message-media.service';
import {
  CampaignOrderRow,
  CampaignRecipientRow,
  CampaignRow,
  CampaignsRepository,
} from './campaigns.repository';
import { MAX_CAMPAIGN_RECIPIENTS, parseRecipientList } from './recipient-list';
import type {
  CreateCampaignDto,
  UpdateCampaignDetailsDto,
  UpdateCampaignTermsDto,
} from './dto/campaign.dto';

/** Gift types a campaign can offer: handed over at a counter, or delivered to the door. */
const CAMPAIGN_GIFT_TYPES = new Set<string>([
  FulfillmentType.DigitalVoucher,
  FulfillmentType.Physical,
]);

/** Who is acting — for the audit trail. */
export type CampaignActor =
  { kind: 'staff'; userId: string } | { kind: 'company'; campaignId: string };

export interface CampaignGiftOptionView {
  giftTemplateId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  deliveryType: string;
  /** kobo */
  giftValue: number;
  /** kobo — doorstep gifts only */
  deliveryFee: number;
  /** kobo — what one person's gift costs the company, before the fee */
  seatPrice: number;
  /** False when it can no longer be bought (pulled from sale, no partner today). */
  available: boolean;
}

export interface CampaignQuote {
  recipients: number;
  /** kobo — the dearest option, so everyone can pick anything offered */
  seatPrice: number;
  giftTotal: number;
  feeBps: number;
  fee: number;
  amountDue: number;
}

export interface CampaignView {
  id: string;
  status: CampaignRow['status'];
  companyName: string;
  contactName: string;
  contactEmail: string;
  title: string;
  senderDisplayName: string | null;
  message: {
    type: 'text' | 'voice' | 'video';
    text: string | null;
    durationSecs: number | null;
    /** Two-hour link to the company's own recording, so they can check it. */
    playbackUrl: string | null;
  };
  sendAt: string | null;
  giftDays: number;
  options: CampaignGiftOptionView[];
  recipientsCount: number;
  /** Live while editing; the frozen snapshot once checkout has started. */
  quote: CampaignQuote | null;
  /** What still has to be done before paying. Empty = ready. */
  missing: string[];
  paidAt: string | null;
  linksSentAt: string | null;
  mediaEnabled: boolean;
}

export interface OpsCampaignView extends CampaignView {
  feeBps: number;
  leadId: string | null;
  contactPhone: string | null;
  /** The company's private link. Treat like a password. */
  portalUrl: string;
  createdAt: string;
}

export interface CampaignSummary {
  id: string;
  companyName: string;
  title: string;
  status: CampaignRow['status'];
  recipients: number | null;
  amountDue: number | null;
  sendAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export type RecipientStage =
  | 'not_paid'
  | 'waiting'
  | 'sent'
  | 'opened'
  | 'on_its_way'
  | 'used'
  | 'expired'
  | 'refunded'
  | 'problem';

export interface CampaignReportRow {
  recipientId: string;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
  stage: RecipientStage;
  giftName: string | null;
  /** Recipient hasn't picked yet (choice campaigns). */
  choosing: boolean;
  linkSentAt: string | null;
  linkSendError: string | null;
  thanks: string | null;
}

export interface CampaignReport {
  totals: Record<RecipientStage, number> & { people: number; thanked: number };
  /** kobo */
  money: {
    paid: number;
    used: number;
    /** Unused value owed back to the company so far — expired gifts in full, plus the difference when someone picked a cheaper option. */
    creditDue: number;
  };
  /** Per-gift counts — what people actually chose. */
  choices: { giftTemplateId: string; name: string; count: number }[];
  rows: CampaignReportRow[];
  thanks: { name: string; note: string; at: string }[];
}

export interface AddRecipientsResult {
  added: number;
  alreadyOnList: number;
  problems: { line: number; reason: string }[];
  total: number;
}

/**
 * Company campaigns: set up by ops, filled in and paid for by the company
 * on its own link, then turned into one ordinary order per person when
 * Paystack confirms the payment (CampaignFundingService).
 *
 * Everything a company can change is frozen the moment checkout starts —
 * the amount Paystack charges is a snapshot of the list and the gifts,
 * and fund_campaign() refuses a payment that doesn't match it.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly repository: CampaignsRepository,
    private readonly gifts: GiftsService,
    private readonly pricing: PricingService,
    private readonly paystack: PaystackClientService,
    private readonly media: MessageMediaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------ ops

  async create(
    staffUserId: string,
    dto: CreateCampaignDto,
  ): Promise<OpsCampaignView> {
    const row = await this.repository.create({
      company_name: dto.companyName,
      contact_name: dto.contactName,
      contact_email: dto.contactEmail.toLowerCase(),
      contact_phone: dto.contactPhone ?? null,
      title: dto.title ?? 'A thank-you from us',
      fee_bps: dto.feeBps ?? 1000,
      lead_id: dto.leadId ?? null,
      created_by: staffUserId,
    });
    await this.record(
      { kind: 'staff', userId: staffUserId },
      'campaign.created',
      row.id,
      {
        companyName: row.company_name,
        feeBps: row.fee_bps,
      },
    );
    return this.opsView(row);
  }

  async list(): Promise<CampaignSummary[]> {
    const rows = await this.repository.list();
    return rows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      title: row.title,
      status: row.status,
      recipients: row.recipients_count,
      amountDue: row.amount_due,
      sendAt: row.send_at,
      paidAt: row.paid_at,
      createdAt: row.created_at,
    }));
  }

  async getForOps(id: string): Promise<OpsCampaignView> {
    return this.opsView(await this.require(id));
  }

  async updateTerms(
    staffUserId: string,
    id: string,
    dto: UpdateCampaignTermsDto,
  ): Promise<OpsCampaignView> {
    const changes: Partial<CampaignRow> = {};
    if (dto.feeBps !== undefined) changes.fee_bps = dto.feeBps;
    if (dto.contactEmail !== undefined)
      changes.contact_email = dto.contactEmail.toLowerCase();
    const row = await this.repository.update(id, changes, ['draft']);
    if (!row) {
      throw new ConflictException(
        "Terms can only change before the company starts paying. Reopen it from the company's link first.",
      );
    }
    await this.record(
      { kind: 'staff', userId: staffUserId },
      'campaign.terms_changed',
      id,
      {
        fields: Object.keys(changes),
      },
    );
    return this.opsView(row);
  }

  async cancel(staffUserId: string, id: string): Promise<OpsCampaignView> {
    const row = await this.repository.update(id, { status: 'cancelled' }, [
      'draft',
      'awaiting_payment',
    ]);
    if (!row) {
      throw new ConflictException(
        'Only an unpaid campaign can be cancelled. A paid one is refunded gift by gift, or credited.',
      );
    }
    await this.record(
      { kind: 'staff', userId: staffUserId },
      'campaign.cancelled',
      id,
    );
    return this.opsView(row);
  }

  /** A new link; the old one stops working at once. */
  async rotateLink(staffUserId: string, id: string): Promise<OpsCampaignView> {
    const row = await this.repository.update(
      id,
      { portal_token: randomUUID() },
      ['draft', 'awaiting_payment', 'paid'],
    );
    if (!row) throw new NotFoundException('Campaign not found.');
    await this.record(
      { kind: 'staff', userId: staffUserId },
      'campaign.link_rotated',
      id,
    );
    return this.opsView(row);
  }

  // ------------------------------------------------------------ company

  async view(campaign: CampaignRow): Promise<CampaignView> {
    const [options, count] = await Promise.all([
      this.optionViews(campaign),
      this.repository.countRecipients(campaign.id),
    ]);
    const quote =
      campaign.status === 'draft'
        ? this.quote(campaign, options, count)
        : snapshotQuote(campaign);
    const playbackUrl =
      campaign.message_url && campaign.message_type !== 'text'
        ? await this.media.playbackUrl(campaign.message_url)
        : null;
    return {
      id: campaign.id,
      status: campaign.status,
      companyName: campaign.company_name,
      contactName: campaign.contact_name,
      contactEmail: campaign.contact_email,
      title: campaign.title,
      senderDisplayName: campaign.sender_display_name,
      message: {
        type: campaign.message_type,
        text: campaign.message_text,
        durationSecs: campaign.message_duration_secs,
        playbackUrl,
      },
      sendAt: campaign.send_at,
      giftDays: campaign.gift_days,
      options,
      recipientsCount: count,
      quote,
      missing:
        campaign.status === 'draft' ? missingFor(campaign, options, count) : [],
      paidAt: campaign.paid_at,
      linksSentAt: campaign.links_sent_at,
      mediaEnabled: this.media.isEnabled(),
    };
  }

  /** Gifts a company can offer: the live catalogue, minus types a campaign can't fulfil. */
  async catalogue() {
    const items = await this.gifts.listAvailable();
    return items
      .filter((item) => CAMPAIGN_GIFT_TYPES.has(item.deliveryType))
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        imageUrl: item.imageUrl,
        deliveryType: item.deliveryType,
        giftValue: item.basePrice,
        deliveryFee: item.deliveryFee,
        seatPrice: item.basePrice + item.deliveryFee,
      }));
  }

  async updateDetails(
    campaign: CampaignRow,
    dto: UpdateCampaignDetailsDto,
  ): Promise<CampaignView> {
    const changes: Partial<CampaignRow> = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.senderDisplayName !== undefined)
      changes.sender_display_name = dto.senderDisplayName;
    if (dto.messageText !== undefined) changes.message_text = dto.messageText;
    if (dto.giftDays !== undefined) changes.gift_days = dto.giftDays;
    if (dto.sendAt !== undefined) {
      if (dto.sendAt !== null) {
        const at = new Date(dto.sendAt);
        const max = Date.now() + 120 * 24 * 60 * 60_000;
        if (at.getTime() < Date.now() - 5 * 60_000 || at.getTime() > max) {
          throw new BadRequestException(
            'Choose a send time from now up to four months ahead, or "as soon as it\'s paid".',
          );
        }
        changes.send_at = at.toISOString();
      } else {
        changes.send_at = null;
      }
    }
    const row = await this.editable(campaign, changes);
    return this.view(row);
  }

  async setMessageMedia(
    campaign: CampaignRow,
    kind: 'voice' | 'video',
    file: UploadedMedia | undefined,
    durationSecs: number | undefined,
  ): Promise<CampaignView> {
    this.assertDraft(campaign);
    if (!this.media.isEnabled()) {
      throw new BadRequestException(
        "Voice and video messages aren't available just now. Write your message instead.",
      );
    }
    if (!file || file.size === 0) {
      throw new BadRequestException('Record or choose your message first.');
    }
    if (durationSecs !== undefined && durationSecs > MAX_MEDIA_SECONDS[kind]) {
      throw new BadRequestException(
        kind === 'voice'
          ? 'Voice notes can be up to 60 seconds.'
          : 'Videos can be up to 30 seconds.',
      );
    }
    const key = await this.media.store(kind, file);
    let row: CampaignRow;
    try {
      row = await this.editable(campaign, {
        message_type: kind,
        message_url: key,
        message_duration_secs: durationSecs ?? null,
      });
    } catch (err) {
      await this.media.delete(key);
      throw err;
    }
    if (campaign.message_url && campaign.message_url !== key) {
      await this.media.delete(campaign.message_url);
    }
    return this.view(row);
  }

  async clearMessageMedia(campaign: CampaignRow): Promise<CampaignView> {
    const row = await this.editable(campaign, {
      message_type: 'text',
      message_url: null,
      message_duration_secs: null,
    });
    if (campaign.message_url) await this.media.delete(campaign.message_url);
    return this.view(row);
  }

  async setGifts(
    campaign: CampaignRow,
    templateIds: string[],
  ): Promise<CampaignView> {
    this.assertDraft(campaign);
    for (const id of templateIds) {
      const template = await this.gifts.findAvailableById(id);
      if (!CAMPAIGN_GIFT_TYPES.has(template.delivery_type)) {
        throw new BadRequestException(
          `"${template.name}" can't be sent in a company campaign. Choose a gift that's collected or delivered.`,
        );
      }
    }
    await this.repository.replaceOptions(campaign.id, templateIds);
    return this.view(campaign);
  }

  async addRecipients(
    campaign: CampaignRow,
    list: string,
  ): Promise<AddRecipientsResult> {
    this.assertDraft(campaign);
    const parsed = parseRecipientList(list);
    const existing = await this.repository.countRecipients(campaign.id);
    if (existing + parsed.people.length > MAX_CAMPAIGN_RECIPIENTS) {
      throw new BadRequestException(
        `A campaign can hold up to ${MAX_CAMPAIGN_RECIPIENTS} people. This list would make ${existing + parsed.people.length}. Split it into two campaigns.`,
      );
    }
    const added = await this.repository.addRecipients(
      campaign.id,
      parsed.people,
    );
    return {
      added,
      alreadyOnList: parsed.people.length - added,
      problems: parsed.problems.slice(0, 50),
      total: existing + added,
    };
  }

  async recipients(campaign: CampaignRow): Promise<CampaignRecipientRow[]> {
    return this.repository.recipients(campaign.id);
  }

  async removeRecipient(
    campaign: CampaignRow,
    recipientId: string,
  ): Promise<void> {
    this.assertDraft(campaign);
    if (!(await this.repository.removeRecipient(campaign.id, recipientId))) {
      throw new NotFoundException('That person is not on the list.');
    }
  }

  async clearRecipients(campaign: CampaignRow): Promise<void> {
    this.assertDraft(campaign);
    await this.repository.clearRecipients(campaign.id);
  }

  /**
   * Freezes the campaign, snapshots what one gift costs, and opens a
   * Paystack checkout for the total. The webhook — never this — decides
   * that it was paid (CampaignFundingService).
   */
  async checkout(
    campaign: CampaignRow,
  ): Promise<{ checkoutUrl: string; amountDue: number }> {
    this.assertDraft(campaign);

    // Re-checked now, not trusted from the screen: a gift can go off sale
    // between choosing it and paying.
    const options = await this.repository.options(campaign.id);
    const templates: GiftTemplateRow[] = [];
    for (const option of options) {
      templates.push(
        await this.gifts.findAvailableById(option.gift_template_id),
      );
    }
    const views = await this.optionViews(campaign);
    const count = await this.repository.countRecipients(campaign.id);
    const missing = missingFor(campaign, views, count);
    if (missing.length > 0) {
      throw new BadRequestException(`Before paying: ${missing.join(' ')}`);
    }

    for (const template of templates) {
      const price = this.pricing.priceGift(
        template.base_price,
        template.delivery_type,
      );
      await this.repository.snapshotOptionPrice(
        campaign.id,
        template.id,
        price.giftValue,
        price.deliveryFee,
      );
    }
    const quote = this.quote(campaign, views, count);
    if (!quote) throw new BadRequestException('Choose at least one gift.');

    const reference = `ebcmp_${randomUUID()}`;
    const frozen = await this.repository.update(
      campaign.id,
      {
        status: 'awaiting_payment',
        recipients_count: quote.recipients,
        seat_price: quote.seatPrice,
        gift_total: quote.giftTotal,
        fee_amount: quote.fee,
        amount_due: quote.amountDue,
        paystack_reference: reference,
      },
      ['draft'],
    );
    if (!frozen) {
      throw new ConflictException(
        'This campaign changed while you were paying. Reload the page.',
      );
    }

    try {
      const checkout = await this.paystack.initializeTransaction({
        email: campaign.contact_email,
        amountKobo: quote.amountDue,
        reference,
        metadata: { campaignId: campaign.id, company: campaign.company_name },
        callbackPath: '/company',
      });
      await this.record(
        { kind: 'company', campaignId: campaign.id },
        'campaign.checkout_started',
        campaign.id,
        {
          reference,
          amount: quote.amountDue,
          recipients: quote.recipients,
        },
      );
      return {
        checkoutUrl: checkout.authorizationUrl,
        amountDue: quote.amountDue,
      };
    } catch (err) {
      // Nothing was charged: unfreeze so they can try again.
      await this.repository.update(
        campaign.id,
        { status: 'draft', paystack_reference: null },
        ['awaiting_payment'],
      );
      throw err;
    }
  }

  /**
   * Back to editing after starting checkout ("I need to add someone").
   * If they had in fact paid the old checkout, its webhook no longer
   * matches and is flagged for ops to refund (CampaignFundingService) —
   * never silently applied to a different list.
   */
  async reopen(campaign: CampaignRow): Promise<CampaignView> {
    const row = await this.repository.update(
      campaign.id,
      { status: 'draft', paystack_reference: null },
      ['awaiting_payment'],
    );
    if (!row)
      throw new ConflictException(
        'Only a campaign waiting for payment can be reopened.',
      );
    await this.record(
      { kind: 'company', campaignId: campaign.id },
      'campaign.reopened',
      campaign.id,
      {
        abandonedReference: campaign.paystack_reference,
      },
    );
    return this.view(row);
  }

  /** Who got what, who opened, who used it, who said thanks. */
  async report(campaign: CampaignRow): Promise<CampaignReport> {
    const [recipients, orders, options] = await Promise.all([
      this.repository.recipients(campaign.id),
      this.repository.orders(campaign.id),
      this.optionViews(campaign),
    ]);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const optionById = new Map(options.map((o) => [o.giftTemplateId, o]));
    const now = Date.now();

    const totals = {
      people: recipients.length,
      thanked: 0,
      not_paid: 0,
      waiting: 0,
      sent: 0,
      opened: 0,
      on_its_way: 0,
      used: 0,
      expired: 0,
      refunded: 0,
      problem: 0,
    };
    const money = { paid: 0, used: 0, creditDue: 0 };
    const choiceCounts = new Map<string, number>();
    const rows: CampaignReportRow[] = [];
    const thanks: CampaignReport['thanks'] = [];

    for (const r of recipients) {
      const order = r.order_id ? orderById.get(r.order_id) : undefined;
      const option = order ? optionById.get(order.gift_template_id) : undefined;
      const stage = stageOf(order, r, option?.deliveryType, now);
      totals[stage] += 1;
      if (r.thanks_note && r.thanks_at) {
        totals.thanked += 1;
        thanks.push({ name: r.name, note: r.thanks_note, at: r.thanks_at });
      }
      if (order) {
        money.paid += order.total_amount;
        const giftCost = order.gift_value + order.delivery_fee;
        if (stage === 'used') money.used += giftCost;
        if (stage === 'expired') {
          money.creditDue += order.total_amount;
        } else if (order.gift_chosen_at && stage !== 'refunded') {
          money.creditDue += Math.max(0, order.total_amount - giftCost);
        }
        if (order.gift_chosen_at) {
          choiceCounts.set(
            order.gift_template_id,
            (choiceCounts.get(order.gift_template_id) ?? 0) + 1,
          );
        }
      }
      rows.push({
        recipientId: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        note: r.note,
        stage,
        giftName: order?.gift_chosen_at ? (option?.name ?? null) : null,
        choosing: Boolean(
          order && !order.gift_chosen_at && stage !== 'expired',
        ),
        linkSentAt: r.link_sent_at,
        linkSendError: r.link_send_error,
        thanks: r.thanks_note,
      });
    }

    thanks.sort((a, b) => b.at.localeCompare(a.at));
    return {
      totals,
      money,
      choices: options.map((o) => ({
        giftTemplateId: o.giftTemplateId,
        name: o.name,
        count: choiceCounts.get(o.giftTemplateId) ?? 0,
      })),
      rows,
      thanks,
    };
  }

  // ------------------------------------------------------------ helpers

  async findByPortalToken(token: string): Promise<CampaignRow | null> {
    return this.repository.findByPortalToken(token);
  }

  portalUrl(campaign: CampaignRow): string {
    const base = (this.config.get<string>('WEB_APP_BASE_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return `${base}/company/${campaign.portal_token}`;
  }

  private async opsView(row: CampaignRow): Promise<OpsCampaignView> {
    return {
      ...(await this.view(row)),
      feeBps: row.fee_bps,
      leadId: row.lead_id,
      contactPhone: row.contact_phone,
      portalUrl: this.portalUrl(row),
      createdAt: row.created_at,
    };
  }

  private async require(id: string): Promise<CampaignRow> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Campaign not found.');
    return row;
  }

  private assertDraft(campaign: CampaignRow): void {
    if (campaign.status === 'draft') return;
    if (campaign.status === 'awaiting_payment') {
      throw new ConflictException(
        'Checkout has started, so the campaign is locked. Choose "Change something" to edit it again.',
      );
    }
    throw new ConflictException(
      campaign.status === 'paid'
        ? 'This campaign is paid for and can no longer be changed.'
        : 'This campaign was cancelled.',
    );
  }

  private async editable(
    campaign: CampaignRow,
    changes: Partial<CampaignRow>,
  ): Promise<CampaignRow> {
    this.assertDraft(campaign);
    if (Object.keys(changes).length === 0) return campaign;
    const row = await this.repository.update(campaign.id, changes, ['draft']);
    if (!row) {
      throw new ConflictException(
        'This campaign changed in another window. Reload the page.',
      );
    }
    return row;
  }

  private async optionViews(
    campaign: CampaignRow,
  ): Promise<CampaignGiftOptionView[]> {
    const options = await this.repository.options(campaign.id);
    const views: CampaignGiftOptionView[] = [];
    for (const option of options) {
      const template = await this.gifts.findById(option.gift_template_id);
      const live = this.pricing.priceGift(
        template.base_price,
        template.delivery_type,
      );
      // After checkout, the snapshot is the price; before, today's.
      const frozen = campaign.status !== 'draft' && option.gift_value !== null;
      const giftValue = frozen ? (option.gift_value as number) : live.giftValue;
      const deliveryFee = frozen
        ? (option.delivery_fee ?? 0)
        : live.deliveryFee;
      let available = true;
      if (campaign.status === 'draft') {
        try {
          await this.gifts.findAvailableById(template.id);
        } catch {
          available = false;
        }
      }
      views.push({
        giftTemplateId: template.id,
        name: template.name,
        description: template.description,
        imageUrl: template.image_url,
        deliveryType: template.delivery_type,
        giftValue,
        deliveryFee,
        seatPrice: giftValue + deliveryFee,
        available,
      });
    }
    return views;
  }

  private quote(
    campaign: CampaignRow,
    options: CampaignGiftOptionView[],
    recipients: number,
  ): CampaignQuote | null {
    if (options.length === 0) return null;
    const seatPrice = Math.max(...options.map((o) => o.seatPrice));
    const giftTotal = seatPrice * recipients;
    const fee = Math.round((giftTotal * campaign.fee_bps) / 10_000);
    return {
      recipients,
      seatPrice,
      giftTotal,
      feeBps: campaign.fee_bps,
      fee,
      amountDue: giftTotal + fee,
    };
  }

  private async record(
    actor: CampaignActor,
    eventType: string,
    campaignId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      eventType,
      actorId: actor.kind === 'staff' ? actor.userId : null,
      actorType: actor.kind === 'staff' ? 'admin' : 'user',
      resourceType: 'campaign',
      resourceId: campaignId,
      metadata: { ...(metadata ?? {}), via: actor.kind },
    });
  }
}

function snapshotQuote(campaign: CampaignRow): CampaignQuote | null {
  if (campaign.amount_due === null || campaign.seat_price === null) return null;
  return {
    recipients: campaign.recipients_count ?? 0,
    seatPrice: campaign.seat_price,
    giftTotal: campaign.gift_total ?? 0,
    feeBps: campaign.fee_bps,
    fee: campaign.fee_amount ?? 0,
    amountDue: campaign.amount_due,
  };
}

function missingFor(
  campaign: CampaignRow,
  options: CampaignGiftOptionView[],
  recipients: number,
): string[] {
  const missing: string[] = [];
  if (options.length === 0) missing.push('Choose at least one gift.');
  const gone = options.filter((o) => !o.available);
  if (gone.length > 0) {
    missing.push(
      `${gone.map((o) => o.name).join(', ')} can't be bought right now — remove ${gone.length === 1 ? 'it' : 'them'}.`,
    );
  }
  if (recipients === 0) missing.push('Add the people you are sending to.');
  if (recipients > MAX_CAMPAIGN_RECIPIENTS) {
    missing.push(
      `A campaign can hold up to ${MAX_CAMPAIGN_RECIPIENTS} people.`,
    );
  }
  const hasMessage =
    campaign.message_type === 'text'
      ? Boolean(campaign.message_text?.trim())
      : Boolean(campaign.message_url);
  if (!hasMessage) missing.push('Write or record your message.');
  if (
    campaign.send_at &&
    new Date(campaign.send_at).getTime() < Date.now() - 5 * 60_000
  ) {
    missing.push('The send time has passed — choose a new one.');
  }
  return missing;
}

const USED = new Set<string>([
  OrderStatus.Redeemed,
  OrderStatus.Fulfilled,
  OrderStatus.Delivered,
]);
const REFUNDED = new Set<string>([OrderStatus.Refunded, OrderStatus.Cancelled]);
const PROBLEM = new Set<string>([
  OrderStatus.FulfillmentFailed,
  OrderStatus.RedemptionFailed,
  OrderStatus.VendorDeclined,
  OrderStatus.VendorTimeout,
]);

export function stageOf(
  order: CampaignOrderRow | undefined,
  recipient: Pick<CampaignRecipientRow, 'link_sent_at'>,
  deliveryType: string | undefined,
  now: number,
): RecipientStage {
  if (!order) return 'not_paid';
  if (USED.has(order.status)) return 'used';
  if (REFUNDED.has(order.status)) return 'refunded';
  if (PROBLEM.has(order.status)) return 'problem';
  if (order.status === OrderStatus.Expired) return 'expired';
  const isPhysical = deliveryType === FulfillmentType.Physical;
  // A doorstep gift on its way doesn't expire: it's been claimed.
  if (order.status === OrderStatus.Dispatched) return 'on_its_way';
  if (
    new Date(order.expires_at).getTime() <= now &&
    !(isPhysical && order.gift_chosen_at)
  ) {
    return 'expired';
  }
  if (order.status === OrderStatus.RevealOpened) return 'opened';
  return recipient.link_sent_at ? 'sent' : 'waiting';
}
