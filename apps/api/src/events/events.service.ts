import { randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { GroupGiftFundingService } from '../group-gifts/group-gift-funding.service';
import { GroupGiftsService } from '../group-gifts/group-gifts.service';
import type { GroupGiftRow } from '../group-gifts/group-gifts.repository';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { PricingService } from '../pricing/pricing.service';
import { UsersService } from '../users/users.service';
import type { StaffContext } from '../auth/staff.guard';
import {
  AddEventItemDto,
  CashGiftDto,
  CreateEventDto,
  PayoutAccountDto,
  ThankDto,
  UpdateEventDto,
} from './dto/event.dto';
import {
  EVENT_REFERENCE_PREFIX,
  MAX_DAYS_AHEAD,
  MAX_ITEMS,
  MIN_CASH_KOBO,
  eventsCashEnabled,
  eventsEnabled,
  giftsSendAt,
  givingClosesAt,
  hostFeeBps,
  lagosToday,
  parseEventDate,
} from './events.config';
import type { EventType } from './events.config';
import { EventFundingService } from './event-funding.service';
import {
  CashGiftRow,
  CashGiftStatus,
  EventRow,
  EventsRepository,
  UNIQUE_VIOLATION,
} from './events.repository';

const DAY = 86_400_000;

/** One gift-list item, as guests see it. */
export interface EventItemView {
  /** The pot's public token: guests give or chip in at /group/<token>. */
  token: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  deliveryType: string;
  /** kobo */
  price: number;
  /** kobo */
  raised: number;
  /** kobo */
  remaining: number;
  contributorCount: number;
  status: 'open' | 'given' | 'closed';
  /** First names of who gave it, once it's fully given. */
  givenBy: string[];
}

export interface EventPublicView {
  slug: string;
  eventType: EventType;
  title: string;
  eventDate: string;
  city: string;
  status: EventRow['status'];
  /** When giving closes (ISO). */
  givingClosesAt: string;
  giftListEnabled: boolean;
  /** Guests can give cash right now (event, host and SendEbun all allow it). */
  cashOpen: boolean;
  wallEnabled: boolean;
  showAmounts: boolean;
  guestCount: number;
  items: EventItemView[];
  /** kobo — the smallest cash gift. */
  minCash: number;
  serviceFee: { rateBps: number; minKobo: number; maxKobo: number };
}

export interface WallEntry {
  id: string;
  kind: 'cash' | 'gift';
  name: string;
  message: string | null;
  /** kobo, only where both the host and the guest allow amounts. */
  amount: number | null;
  /** For gift-list entries: what they gave towards. */
  giftName: string | null;
  at: string;
}

export interface ThankYouEntry {
  id: string;
  kind: 'cash' | 'share';
  name: string;
  phone: string | null;
  message: string | null;
  amount: number;
  giftName: string | null;
  at: string;
  thanked: boolean;
}

export interface EventHostView {
  public: EventPublicView;
  sharePath: string;
  wallPath: string;
  hostName: string;
  /** kobo */
  cashRaised: number;
  cashCount: number;
  /** kobo — what the host receives after SendEbun's payout fee (0 by default). */
  payoutDue: number;
  payout: {
    status: EventRow['payout_status'];
    accountName: string | null;
    /** "••6789" — the full number is never sent back. */
    accountNumberMasked: string | null;
    bankCode: string | null;
    verified: boolean;
    paidAt: string | null;
    amount: number | null;
  };
  items: (EventItemView & { managePath: string })[];
  thankYous: ThankYouEntry[];
  canCancel: boolean;
}

export interface CreateEventResult {
  slug: string;
  sharePath: string;
  managePath: string;
}

export interface CashGiftResult {
  checkoutUrl: string;
  amount: number;
  serviceFee: number;
  total: number;
}

/**
 * Events: a page where guests give from a gift list or give cash, a
 * live wall, and the host's page.
 *
 * Money rule, as everywhere: nothing here decides a payment happened.
 * A cash gift is a pending row and a Paystack checkout until the signed
 * webhook arrives (EventFundingService). Gift-list items are group-gift
 * pots and use that engine unchanged.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly groupGifts: GroupGiftsService,
    private readonly groupFunding: GroupGiftFundingService,
    private readonly gifts: GiftsService,
    private readonly users: UsersService,
    private readonly pricing: PricingService,
    private readonly paystack: PaystackClientService,
    private readonly funding: EventFundingService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return eventsEnabled(this.config.get<string>('EVENTS'));
  }

  isCashEnabled(): boolean {
    return eventsCashEnabled(this.config.get<string>('EVENTS_CASH'));
  }

  async create(dto: CreateEventDto): Promise<CreateEventResult> {
    assertEventDate(dto.eventDate);
    const remembrance = dto.eventType === 'remembrance';

    const host = await this.users.findOrCreateGuestSender({
      email: dto.hostEmail,
      phone: dto.hostPhone,
      name: dto.hostName,
    });

    const row = {
      host_id: host.id,
      host_name: dto.hostName,
      host_phone: dto.hostPhone,
      event_type: dto.eventType,
      title: dto.title,
      event_date: dto.eventDate,
      city: dto.city,
      gift_list_enabled: dto.giftListEnabled ?? true,
      cash_enabled: dto.cashEnabled ?? false,
      wall_enabled: dto.wallEnabled ?? true,
      // Never amounts at a remembrance, whatever was asked.
      show_amounts: remembrance ? false : (dto.showAmounts ?? false),
    };

    let event: EventRow | null = null;
    for (let attempt = 0; attempt < 3 && !event; attempt++) {
      try {
        event = await this.repository.create({
          ...row,
          slug: makeSlug(dto.title),
        });
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 2) throw err;
      }
    }
    if (!event) throw new Error('Could not create the event');

    await this.audit.record({
      eventType: 'event.created',
      actorId: host.id,
      actorType: 'user',
      resourceType: 'event',
      resourceId: event.id,
      newState: 'active',
      metadata: {
        eventType: event.event_type,
        eventDate: event.event_date,
        cashEnabled: event.cash_enabled,
      },
    });

    return {
      slug: event.slug,
      sharePath: `/e/${event.slug}`,
      managePath: `/e/manage/${event.host_token}`,
    };
  }

  async publicView(slug: string): Promise<EventPublicView> {
    const event = await this.findBySlug(slug);
    const pots = event.gift_list_enabled
      ? await this.groupGifts.eventPots(event.id)
      : [];
    return this.toPublicView(event, pots);
  }

  /**
   * The wall: names and lines of people who chose to be shown, newest
   * first. Never an email or phone number. Amounts only where the host
   * allows them and the guest ticked "show the amount"; never at a
   * remembrance (the table forbids show_amounts there).
   */
  async wall(slug: string, limit = 30): Promise<{ entries: WallEntry[] }> {
    const event = await this.findBySlug(slug);
    if (!event.wall_enabled || event.status === 'cancelled') {
      return { entries: [] };
    }
    const [cash, shares, pots] = await Promise.all([
      this.repository.confirmedCashGifts(event.id, limit, true),
      event.gift_list_enabled
        ? this.groupGifts.eventShares(event.id, limit)
        : Promise.resolve([]),
      event.gift_list_enabled
        ? this.groupGifts.eventPots(event.id)
        : Promise.resolve([] as GroupGiftRow[]),
    ]);
    const giftNames = await this.giftNames(pots);
    const potGift = new Map(
      pots.map((p) => [p.id, giftNames.get(p.gift_template_id)?.name ?? null]),
    );

    const entries: WallEntry[] = [
      ...cash.map((g) => ({
        id: g.id,
        kind: 'cash' as const,
        name: g.guest_name,
        message: g.message,
        amount: event.show_amounts && g.show_amount ? g.amount : null,
        giftName: null,
        at: g.confirmed_at ?? g.created_at,
      })),
      // Gift-list givers didn't write their line for a screen: their
      // message is for the host only. First name and the gift.
      ...shares.map((s) => ({
        id: s.id,
        kind: 'gift' as const,
        name: firstName(s.contributor_name),
        message: null,
        amount: null,
        giftName: potGift.get(s.group_gift_id) ?? null,
        at: s.confirmed_at,
      })),
    ];
    entries.sort((a, b) => b.at.localeCompare(a.at));
    return { entries: entries.slice(0, limit) };
  }

  /** A guest's cash gift: a pending row and a Paystack checkout. */
  async giveCash(slug: string, dto: CashGiftDto): Promise<CashGiftResult> {
    const event = await this.findBySlug(slug);
    if (!this.cashOpen(event)) {
      throw new ConflictException('This event is not taking cash gifts.');
    }
    const amount = dto.amountNaira * 100;
    if (amount < MIN_CASH_KOBO) {
      throw new BadRequestException('The smallest cash gift is ₦500.');
    }
    const cap = this.funding.capKobo();
    if (!event.verified_at && cap > 0 && event.cash_raised + amount > cap) {
      throw new ConflictException(
        'This event can’t take more cash gifts until SendEbun has verified the host. You can still give from the gift list.',
      );
    }

    const serviceFee = this.pricing.serviceFeeFor(amount);
    const total = amount + serviceFee;
    const reference = `${EVENT_REFERENCE_PREFIX}${randomUUID()}`;

    const gift = await this.repository.createCashGift({
      event_id: event.id,
      guest_name: dto.name,
      guest_email: dto.email,
      guest_phone: dto.phone ?? null,
      message: dto.message?.length ? dto.message : null,
      show_on_wall: dto.showOnWall ?? true,
      show_amount: dto.showAmount ?? false,
      amount,
      service_fee: serviceFee,
      total_amount: total,
      paystack_reference: reference,
    });

    try {
      const checkout = await this.paystack.initializeTransaction({
        email: dto.email,
        amountKobo: total,
        reference,
        metadata: { eventId: event.id, cashGiftId: gift.id },
        callbackPath: `/e/${event.slug}?paid=1`,
      });
      return {
        checkoutUrl: checkout.authorizationUrl,
        amount,
        serviceFee,
        total,
      };
    } catch (err) {
      await this.repository.markCashGiftFailed(gift.id).catch(() => undefined);
      throw err;
    }
  }

  async cashGiftStatus(
    slug: string,
    reference: string,
  ): Promise<{ status: CashGiftStatus }> {
    const event = await this.repository.findBySlug(slug);
    const status = event
      ? await this.repository.cashGiftStatus(event.id, reference)
      : null;
    if (!status) throw new NotFoundException('No such payment for this event.');
    return { status };
  }

  // ---------------------------------------------------------------- host

  async hostView(event: EventRow): Promise<EventHostView> {
    const [pots, cash, shares] = await Promise.all([
      this.groupGifts.eventPots(event.id),
      this.repository.confirmedCashGifts(event.id, 500, false),
      this.groupGifts.eventShares(event.id, 500),
    ]);
    const publicView = await this.toPublicView(event, pots);
    const giftNames = await this.giftNames(pots);
    const potGift = new Map(
      pots.map((p) => [p.id, giftNames.get(p.gift_template_id)?.name ?? null]),
    );
    const fee = Math.floor(
      (event.cash_raised *
        hostFeeBps(this.config.get<string>('EVENT_HOST_FEE_BPS'))) /
        10_000,
    );

    const thankYous: ThankYouEntry[] = [
      ...cash.map((g: CashGiftRow) => ({
        id: g.id,
        kind: 'cash' as const,
        name: g.guest_name,
        phone: g.guest_phone,
        message: g.message,
        amount: g.amount,
        giftName: null,
        at: g.confirmed_at ?? g.created_at,
        thanked: g.thanked_at !== null,
      })),
      ...shares.map((s) => ({
        id: s.id,
        kind: 'share' as const,
        name: s.contributor_name,
        phone: s.contributor_phone,
        message: s.message,
        amount: s.amount,
        giftName: potGift.get(s.group_gift_id) ?? null,
        at: s.confirmed_at,
        thanked: s.thanked_at !== null,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return {
      public: publicView,
      sharePath: `/e/${event.slug}`,
      wallPath: `/e/${event.slug}/wall`,
      hostName: event.host_name,
      cashRaised: event.cash_raised,
      cashCount: event.cash_count,
      payoutDue: event.status === 'cancelled' ? 0 : event.cash_raised - fee,
      payout: {
        status: event.payout_status,
        accountName: event.payout_account_name,
        accountNumberMasked: event.payout_account_number
          ? `••${event.payout_account_number.slice(-4)}`
          : null,
        bankCode: event.payout_bank_code,
        verified: event.verified_at !== null,
        paidAt: event.paid_out_at,
        amount: event.payout_amount,
      },
      items: publicView.items.map((item) => {
        const pot = pots.find((p) => p.token === item.token);
        return {
          ...item,
          managePath: pot ? `/group/manage/${pot.organiser_token}` : '',
        };
      }),
      thankYous,
      canCancel: event.status !== 'cancelled' && event.payout_status === 'none',
    };
  }

  async update(event: EventRow, dto: UpdateEventDto): Promise<void> {
    const changes: Parameters<EventsRepository['update']>[1] = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.city !== undefined) changes.city = dto.city;
    if (dto.giftListEnabled !== undefined)
      changes.gift_list_enabled = dto.giftListEnabled;
    if (dto.cashEnabled !== undefined) changes.cash_enabled = dto.cashEnabled;
    if (dto.wallEnabled !== undefined) changes.wall_enabled = dto.wallEnabled;
    if (dto.showAmounts !== undefined) {
      changes.show_amounts =
        event.event_type === 'remembrance' ? false : dto.showAmounts;
    }
    if (Object.keys(changes).length === 0) return;
    if (!(await this.repository.update(event.id, changes))) {
      throw new ConflictException('This event has ended and can’t be changed.');
    }
    await this.audit.record({
      eventType: 'event.updated',
      actorId: event.host_id,
      actorType: 'user',
      resourceType: 'event',
      resourceId: event.id,
      metadata: { fields: Object.keys(changes) },
    });
  }

  async addItem(event: EventRow, dto: AddEventItemDto): Promise<EventItemView> {
    if (event.status !== 'active') {
      throw new ConflictException('This event has ended and can’t be changed.');
    }
    if (!event.gift_list_enabled) {
      throw new ConflictException('Turn the gift list on first.');
    }
    const existing = await this.groupGifts.eventPots(event.id);
    if (existing.filter((p) => p.status !== 'cancelled').length >= MAX_ITEMS) {
      throw new BadRequestException(
        `A gift list can have up to ${MAX_ITEMS} gifts.`,
      );
    }
    const pot = await this.groupGifts.createForEvent({
      eventId: event.id,
      giftTemplateId: dto.giftTemplateId,
      hostId: event.host_id,
      hostName: event.host_name,
      recipientName: event.title,
      recipientPhone: event.host_phone,
      deadline: givingClosesAt(event.event_date),
      sendAt: giftsSendAt(event.event_date),
      showAmounts: event.show_amounts,
    });
    const names = await this.giftNames([pot]);
    return itemView(pot, names, new Map());
  }

  async removeItem(
    event: EventRow,
    groupGiftId: string,
  ): Promise<{ refunds: number }> {
    return this.groupGifts.removeEventItem(event.id, groupGiftId);
  }

  /** Changing the account clears verification: ops checks again before any payout. */
  async setPayoutAccount(
    event: EventRow,
    dto: PayoutAccountDto,
  ): Promise<void> {
    if (!(await this.repository.setPayoutAccount(event.id, dto))) {
      throw new ConflictException(
        'The payout account can no longer be changed.',
      );
    }
    await this.audit.record({
      eventType: 'event.payout_account_set',
      actorId: event.host_id,
      actorType: 'user',
      resourceType: 'event',
      resourceId: event.id,
      // Field names only, never the account itself.
      metadata: {
        fields: [
          'payout_bank_code',
          'payout_account_number',
          'payout_account_name',
        ],
      },
    });
  }

  async thank(event: EventRow, dto: ThankDto): Promise<void> {
    const done =
      dto.kind === 'cash'
        ? await this.repository.markCashThanked(event.id, dto.id)
        : await this.groupGifts.markEventShareThanked(event.id, dto.id);
    if (!done) throw new NotFoundException('That gift is not on this event.');
  }

  /** Cash refunded in full; gift-list pots still collecting are closed and refunded. */
  async cancel(event: EventRow, reason: string): Promise<{ refunds: number }> {
    const owed = await this.repository.cancel(event.id, reason, 'user');
    if (owed < 0) {
      throw new ConflictException('This event can no longer be cancelled.');
    }
    this.funding.kickRefunds();
    this.groupFunding.kickRefunds();
    return { refunds: owed };
  }

  // ----------------------------------------------------------------- ops

  async opsList(): Promise<
    {
      id: string;
      slug: string;
      title: string;
      eventType: EventType;
      eventDate: string;
      status: EventRow['status'];
      hostName: string;
      cashRaised: number;
      cashCount: number;
      payoutDue: number;
      payoutStatus: EventRow['payout_status'];
      accountName: string | null;
      bankCode: string | null;
      accountNumber: string | null;
      verified: boolean;
      readyToPay: boolean;
    }[]
  > {
    const bps = hostFeeBps(this.config.get<string>('EVENT_HOST_FEE_BPS'));
    const rows = await this.repository.listForOps(200);
    return rows.map((e) => {
      const due = e.cash_raised - Math.floor((e.cash_raised * bps) / 10_000);
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        eventType: e.event_type,
        eventDate: e.event_date,
        status: e.status,
        hostName: e.host_name,
        cashRaised: e.cash_raised,
        cashCount: e.cash_count,
        payoutDue: e.status === 'cancelled' ? 0 : due,
        payoutStatus: e.payout_status,
        accountName: e.payout_account_name,
        bankCode: e.payout_bank_code,
        // Staff pay this account by hand, so they see it in full.
        accountNumber: e.payout_account_number,
        verified: e.verified_at !== null,
        readyToPay:
          e.status === 'closed' &&
          e.payout_status === 'none' &&
          e.verified_at !== null &&
          e.cash_raised > 0,
      };
    });
  }

  async verify(eventId: string, staff: StaffContext): Promise<void> {
    if (!(await this.repository.verify(eventId, staff.userId))) {
      throw new ConflictException(
        'Only an event with a payout account, not yet paid, can be verified.',
      );
    }
    await this.audit.record({
      eventType: 'event.host_verified',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'event',
      resourceId: eventId,
    });
  }

  async recordPayout(
    eventId: string,
    reference: string,
    staff: StaffContext,
  ): Promise<{ amount: number }> {
    const event = await this.repository.findById(eventId);
    if (!event) throw new NotFoundException('No such event.');
    const bps = hostFeeBps(this.config.get<string>('EVENT_HOST_FEE_BPS'));
    const amount =
      event.cash_raised - Math.floor((event.cash_raised * bps) / 10_000);
    let recorded: boolean;
    try {
      recorded = await this.repository.recordPayout(
        eventId,
        amount,
        reference,
        staff.userId,
      );
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes('event_not_closed')) {
        throw new ConflictException('Giving hasn’t closed yet for this event.');
      }
      if (message.includes('event_not_verified')) {
        throw new ConflictException('Verify the host’s payout account first.');
      }
      throw err;
    }
    if (!recorded)
      throw new ConflictException('This payout was already recorded.');
    return { amount };
  }

  // ------------------------------------------------------------- helpers

  private async findBySlug(slug: string): Promise<EventRow> {
    const event = await this.repository.findBySlug(slug);
    if (!event) throw new NotFoundException('No event found for this link.');
    return event;
  }

  private cashOpen(event: EventRow): boolean {
    return (
      this.isCashEnabled() &&
      event.cash_enabled &&
      event.status === 'active' &&
      Date.now() < givingClosesAt(event.event_date).getTime()
    );
  }

  private async toPublicView(
    event: EventRow,
    pots: GroupGiftRow[],
  ): Promise<EventPublicView> {
    const live = pots.filter((p) => p.status !== 'cancelled');
    const names = await this.giftNames(live);
    // Who gave each fully-given item: one query for the whole list, only
    // when there's something to show (small groups; a big pot shows a count).
    const givenBy = new Map<string, string[]>();
    if (live.some((p) => isGiven(p) && p.contributor_count <= GIVEN_BY_MAX)) {
      for (const share of await this.groupGifts.eventShares(event.id, 500)) {
        const list = givenBy.get(share.group_gift_id) ?? [];
        list.push(firstName(share.contributor_name));
        givenBy.set(share.group_gift_id, list);
      }
    }
    const items = live.map((p) => itemView(p, names, givenBy));
    return {
      slug: event.slug,
      eventType: event.event_type,
      title: event.title,
      eventDate: event.event_date,
      city: event.city,
      status: event.status,
      givingClosesAt: givingClosesAt(event.event_date).toISOString(),
      giftListEnabled: event.gift_list_enabled,
      cashOpen: this.cashOpen(event),
      wallEnabled: event.wall_enabled,
      showAmounts: event.show_amounts,
      guestCount:
        event.cash_count +
        live.reduce((sum, p) => sum + p.contributor_count, 0),
      items: event.status === 'cancelled' ? [] : items,
      minCash: MIN_CASH_KOBO,
      serviceFee: this.pricing.servicePolicy(),
    };
  }

  /** Gift templates behind these pots, fetched once each. */
  private async giftNames(
    pots: GroupGiftRow[],
  ): Promise<Map<string, TemplateInfo>> {
    const ids = [...new Set(pots.map((p) => p.gift_template_id))];
    const templates = await Promise.all(
      ids.map((id) => this.gifts.findById(id)),
    );
    return new Map(
      templates.map((t, i) => [
        ids[i],
        {
          name: t.name,
          description: t.description,
          image_url: t.image_url,
          delivery_type: t.delivery_type,
        },
      ]),
    );
  }
}

type TemplateInfo = {
  name: string;
  description: string | null;
  image_url: string | null;
  delivery_type: string;
};

/** Name the givers of a fully-given item only when they're a handful. */
const GIVEN_BY_MAX = 6;

function isGiven(pot: GroupGiftRow): boolean {
  return pot.status === 'funded' || pot.status === 'triggered';
}

function itemView(
  pot: GroupGiftRow,
  names: Map<string, TemplateInfo>,
  givenBy: Map<string, string[]>,
): EventItemView {
  const template = names.get(pot.gift_template_id);
  const given = isGiven(pot);
  return {
    token: pot.token,
    name: template?.name ?? 'Gift',
    description: template?.description ?? null,
    imageUrl: template?.image_url ?? null,
    deliveryType: template?.delivery_type ?? 'digital_voucher',
    price: pot.target_amount,
    raised: pot.amount_raised,
    remaining:
      pot.status === 'open'
        ? Math.max(0, pot.target_amount - pot.amount_raised)
        : 0,
    contributorCount: pot.contributor_count,
    status: given ? 'given' : pot.status === 'open' ? 'open' : 'closed',
    givenBy:
      given && pot.contributor_count <= GIVEN_BY_MAX
        ? (givenBy.get(pot.id) ?? [])
        : [],
  };
}

function assertEventDate(value: string): void {
  if (!parseEventDate(value)) {
    throw new BadRequestException('That isn’t a real date.');
  }
  const today = lagosToday();
  if (value < today) {
    throw new BadRequestException('The event date has already passed.');
  }
  const latest = new Date(
    Date.parse(`${today}T00:00:00Z`) + MAX_DAYS_AHEAD * DAY,
  )
    .toISOString()
    .slice(0, 10);
  if (value > latest) {
    throw new BadRequestException('Events can be set up to a year ahead.');
  }
}

/** "Tola & Dayo" -> "tola-and-dayo-k3f9". The suffix keeps links unguessable from names alone. */
export function makeSlug(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const suffix = [...randomBytes(5)]
    .map((b) => alphabet[b % alphabet.length])
    .join('');
  return `${words || 'event'}-${suffix}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === UNIQUE_VIOLATION
  );
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err
    ? String(err.message)
    : String(err);
}
