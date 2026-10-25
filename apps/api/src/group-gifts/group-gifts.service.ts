import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { PricingService } from '../pricing/pricing.service';
import { UsersService } from '../users/users.service';
import {
  ContributeDto,
  CreateGroupGiftDto,
  ExtendGroupGiftDto,
  SwitchGroupGiftDto,
} from './dto/group-gift.dto';
import {
  DECISION_WINDOW_HOURS,
  GROUP_REFERENCE_PREFIX,
  MAX_DEADLINE_DAYS,
  MAX_EXTENSION_DAYS,
  MIN_CONTRIBUTION_KOBO,
  MIN_DEADLINE_MINUTES,
  groupGiftingEnabled,
} from './group-gifts.config';
import {
  ContributionRow,
  GroupGiftRow,
  GroupGiftsRepository,
} from './group-gifts.repository';
import { GroupGiftFundingService } from './group-gift-funding.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What the pot is for, as everyone with the link sees it. */
interface GiftSummary {
  giftTemplateId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  deliveryType: string;
}

/**
 * The public pot page. Deliberately thin: first names only, never a
 * phone number, and no one's message — those are for the recipient.
 */
export interface GroupGiftPublicView {
  status: 'open' | 'awaiting_organiser' | 'funded' | 'closed';
  gift: GiftSummary;
  recipientFirstName: string;
  organiserFirstName: string | null;
  /** kobo */
  targetAmount: number;
  /** kobo */
  amountRaised: number;
  /** kobo, 0 once funded */
  remaining: number;
  /** kobo — the smallest share accepted right now */
  minContribution: number;
  contributorCount: number;
  deadline: string;
  /** Names always; amount only when the organiser chose to show amounts. */
  contributors: { name: string; amount: number | null }[];
  /**
   * The fee rule, so the page can show each share's fee as it's typed.
   * Same policy PricingService charges with; the checkout total still
   * comes from the API.
   */
  serviceFee: { rateBps: number; minKobo: number; maxKobo: number };
}

export interface GroupGiftOrganiserView {
  status: GroupGiftRow['status'];
  /** open and past the deadline: the organiser has a decision to make. */
  awaitingDecision: boolean;
  /** When the pot closes and refunds everyone if no decision is made. */
  decisionDeadline: string | null;
  gift: GiftSummary;
  recipientName: string;
  message: string | null;
  targetAmount: number;
  amountRaised: number;
  remaining: number;
  deadline: string;
  sendAt: string | null;
  showAmounts: boolean;
  canExtend: boolean;
  canSwitch: boolean;
  canCancel: boolean;
  /** Path the contributors' link opens, e.g. /group/<token>. */
  sharePath: string;
  /** Once the pot became a gift: the recipient's link to send them. */
  revealPath: string | null;
  closeReason: string | null;
  contributors: {
    name: string;
    amount: number;
    message: string | null;
    status: ContributionRow['status'];
    /** kobo being returned to them, if any (cancelled pot, late payment, switch surplus). */
    refundAmount: number | null;
    refundStatus: ContributionRow['refund_status'];
  }[];
}

export interface CreateGroupGiftResult {
  groupGiftId: string;
  sharePath: string;
  managePath: string;
  targetAmount: number;
}

export interface ContributeResult {
  checkoutUrl: string;
  /** kobo */
  amount: number;
  /** kobo */
  serviceFee: number;
  /** kobo — what Paystack will charge */
  total: number;
}

/** For the reveal: everyone who chipped in, and what they said. */
export interface GroupGiftRevealInfo {
  organiserName: string | null;
  contributorCount: number;
  contributors: { name: string; message: string | null }[];
}

/**
 * Group gifting: start a pot, chip in, and the organiser's decisions.
 *
 * Money rule: nothing here decides a payment happened. A contribution is
 * a pending row and a Paystack checkout until the signed charge.success
 * webhook arrives (GroupGiftFundingService), and every change to what a
 * pot holds is one locked SQL call.
 */
@Injectable()
export class GroupGiftsService {
  constructor(
    private readonly repository: GroupGiftsRepository,
    private readonly gifts: GiftsService,
    private readonly users: UsersService,
    private readonly pricing: PricingService,
    private readonly paystack: PaystackClientService,
    private readonly funding: GroupGiftFundingService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return groupGiftingEnabled(this.config.get<string>('GROUP_GIFTING'));
  }

  async create(dto: CreateGroupGiftDto): Promise<CreateGroupGiftResult> {
    const now = Date.now();
    const deadline = parseFuture(dto.deadline, 'deadline');
    if (deadline.getTime() < now + MIN_DEADLINE_MINUTES * 60_000) {
      throw new BadRequestException('Give people at least an hour to chip in.');
    }
    if (deadline.getTime() > now + MAX_DEADLINE_DAYS * DAY) {
      throw new BadRequestException(
        `The deadline can be up to ${MAX_DEADLINE_DAYS} days away.`,
      );
    }
    let sendAt: Date | null = null;
    if (dto.sendAt) {
      sendAt = parseFuture(dto.sendAt, 'sendAt');
      if (sendAt.getTime() > now + (MAX_DEADLINE_DAYS + 30) * DAY) {
        throw new BadRequestException('That send date is too far away.');
      }
    }

    const template = await this.gifts.findAvailableById(dto.giftTemplateId);
    // Same price a sender would pay for this gift on its own, minus the
    // sender fee: each contributor pays the fee on their own share.
    const price = this.pricing.priceGift(
      template.base_price,
      template.delivery_type,
    );
    const target = price.giftValue + price.deliveryFee;

    const organiser = await this.users.findOrCreateGuestSender({
      email: dto.organiserEmail,
      phone: dto.organiserPhone,
      name: dto.organiserName,
    });

    const pot = await this.repository.create({
      gift_template_id: template.id,
      organiser_id: organiser.id,
      recipient_name: dto.recipientName,
      recipient_phone: dto.recipientPhone,
      target_amount: target,
      gift_value: price.giftValue,
      delivery_fee: price.deliveryFee,
      deadline: deadline.toISOString(),
      send_at: sendAt?.toISOString() ?? null,
      sender_message: dto.message?.length ? dto.message : null,
      show_amounts: dto.showAmounts ?? false,
    });

    await this.audit.record({
      eventType: 'group_gift.created',
      actorId: organiser.id,
      actorType: 'user',
      resourceType: 'group_gift',
      resourceId: pot.id,
      newState: 'open',
      metadata: { giftTemplateId: template.id, target },
    });

    return {
      groupGiftId: pot.id,
      sharePath: `/group/${pot.token}`,
      managePath: `/group/manage/${pot.organiser_token}`,
      targetAmount: target,
    };
  }

  async publicView(token: string): Promise<GroupGiftPublicView> {
    const pot = await this.repository.findByToken(token);
    if (!pot) throw new NotFoundException('No group gift found for this link.');

    const [template, organiser, contributions] = await Promise.all([
      this.gifts.findById(pot.gift_template_id),
      this.users.findById(pot.organiser_id),
      this.repository.contributions(pot.id),
    ]);
    const remaining = remainingOf(pot);

    return {
      status: publicStatus(pot),
      gift: giftSummary(template),
      recipientFirstName: firstName(pot.recipient_name),
      organiserFirstName: organiser?.name ? firstName(organiser.name) : null,
      targetAmount: pot.target_amount,
      amountRaised: pot.amount_raised,
      remaining,
      minContribution: Math.min(MIN_CONTRIBUTION_KOBO, remaining),
      contributorCount: pot.contributor_count,
      deadline: pot.deadline,
      contributors: contributions
        .filter((c) => c.status === 'confirmed')
        .map((c) => ({
          name: firstName(c.contributor_name),
          amount: pot.show_amounts ? c.amount : null,
        })),
      serviceFee: this.pricing.servicePolicy(),
    };
  }

  /**
   * One share. Capped at what's left to reach the target, so the pot
   * can't be overpaid by ordinary use. Two people checking out the last
   * share at the same moment can still both pay: the first funds the
   * pot, the second is confirmed 'late' and refunded in full.
   */
  async contribute(
    token: string,
    dto: ContributeDto,
  ): Promise<ContributeResult> {
    const pot = await this.repository.findByToken(token);
    if (!pot) throw new NotFoundException('No group gift found for this link.');
    if (pot.status !== 'open') {
      throw new ConflictException(
        pot.status === 'funded' || pot.status === 'triggered'
          ? 'This gift is fully paid for. Thank you!'
          : 'This group gift has closed.',
      );
    }
    // Past the deadline the pot stays open while the organiser decides
    // (DECISION_WINDOW_HOURS): a share then is exactly what finishes the
    // gift — including the organiser topping it up themselves. After the
    // window the pot closes, and anything that still lands is refunded.
    const windowEnds =
      new Date(pot.deadline).getTime() + DECISION_WINDOW_HOURS * HOUR;
    if (windowEnds <= Date.now()) {
      throw new ConflictException('This group gift has closed.');
    }

    const remaining = remainingOf(pot);
    const amount = dto.amountNaira * 100;
    const floor = Math.min(MIN_CONTRIBUTION_KOBO, remaining);
    if (amount < floor) {
      throw new BadRequestException(
        `The smallest share is ₦${(floor / 100).toLocaleString('en-NG')}.`,
      );
    }
    if (amount > remaining) {
      throw new BadRequestException(
        `Only ₦${(remaining / 100).toLocaleString('en-NG')} is left to reach the target.`,
      );
    }

    const serviceFee = this.pricing.serviceFeeFor(amount);
    const total = amount + serviceFee;
    const reference = `${GROUP_REFERENCE_PREFIX}${randomUUID()}`;

    const contribution = await this.repository.createContribution({
      group_gift_id: pot.id,
      contributor_name: dto.name,
      contributor_email: dto.email,
      contributor_phone: dto.phone ?? null,
      amount,
      service_fee: serviceFee,
      total_amount: total,
      message: dto.message?.length ? dto.message : null,
      paystack_reference: reference,
    });

    try {
      const checkout = await this.paystack.initializeTransaction({
        email: dto.email,
        amountKobo: total,
        reference,
        metadata: { groupGiftId: pot.id, contributionId: contribution.id },
        callbackPath: `/group/${pot.token}?paid=1`,
      });
      return {
        checkoutUrl: checkout.authorizationUrl,
        amount,
        serviceFee,
        total,
      };
    } catch (err) {
      // No checkout exists, so this row can never be paid.
      await this.repository
        .markContributionFailed(contribution.id)
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * "Did my share land?" — for the page Paystack returns a contributor
   * to, with the reference Paystack puts on that address. The reference
   * is an unguessable id the contributor's own checkout created, and the
   * answer is one word about that one share, scoped to this pot.
   */
  async contributionStatus(
    token: string,
    reference: string,
  ): Promise<{ status: ContributionRow['status'] }> {
    const pot = await this.repository.findByToken(token);
    const status = pot
      ? await this.repository.contributionStatus(pot.id, reference)
      : null;
    if (!status) throw new NotFoundException('No such payment for this gift.');
    return { status };
  }

  async organiserView(pot: GroupGiftRow): Promise<GroupGiftOrganiserView> {
    const [template, contributions, revealToken] = await Promise.all([
      this.gifts.findById(pot.gift_template_id),
      this.repository.contributions(pot.id),
      pot.linked_order_id
        ? this.repository.orderRevealToken(pot.linked_order_id)
        : Promise.resolve(null),
    ]);
    const deadlinePassed = new Date(pot.deadline).getTime() <= Date.now();
    const open = pot.status === 'open';

    return {
      status: pot.status,
      awaitingDecision: open && deadlinePassed,
      decisionDeadline: open
        ? new Date(
            new Date(pot.deadline).getTime() + DECISION_WINDOW_HOURS * HOUR,
          ).toISOString()
        : null,
      gift: giftSummary(template),
      recipientName: pot.recipient_name,
      message: pot.sender_message,
      targetAmount: pot.target_amount,
      amountRaised: pot.amount_raised,
      remaining: remainingOf(pot),
      deadline: pot.deadline,
      sendAt: pot.send_at,
      showAmounts: pot.show_amounts,
      canExtend: open && !pot.deadline_extended,
      canSwitch: open && pot.amount_raised > 0,
      canCancel: open,
      sharePath: `/group/${pot.token}`,
      revealPath: revealToken ? `/reveal/${revealToken}` : null,
      closeReason: pot.close_reason,
      contributors: contributions.map((c) => ({
        name: c.contributor_name,
        amount: c.amount,
        message: c.message,
        status: c.status,
        refundAmount: c.refund_amount,
        refundStatus: c.refund_status,
      })),
    };
  }

  /** Once, up to MAX_EXTENSION_DAYS past the original deadline. */
  async extend(pot: GroupGiftRow, dto: ExtendGroupGiftDto): Promise<void> {
    if (pot.status !== 'open' || pot.deadline_extended) {
      throw new ConflictException('This deadline can no longer be extended.');
    }
    const next = parseFuture(dto.deadline, 'deadline');
    const original = new Date(pot.deadline).getTime();
    if (next.getTime() <= original) {
      throw new BadRequestException('Pick a time after the current deadline.');
    }
    if (next.getTime() > original + MAX_EXTENSION_DAYS * DAY) {
      throw new BadRequestException(
        `You can extend by up to ${MAX_EXTENSION_DAYS} days.`,
      );
    }
    if (!(await this.repository.extend(pot.id, next.toISOString()))) {
      throw new ConflictException('This deadline can no longer be extended.');
    }
    await this.audit.record({
      eventType: 'group_gift.extended',
      actorId: pot.organiser_id,
      actorType: 'user',
      resourceType: 'group_gift',
      resourceId: pot.id,
      metadata: { from: pot.deadline, to: next.toISOString() },
    });
  }

  /**
   * Switch to a gift the pot already covers. The price is the catalogue
   * price today, from PricingService, as at creation. Anything above it
   * goes back to contributors pro rata (switch_group_gift).
   */
  async switchGift(
    pot: GroupGiftRow,
    dto: SwitchGroupGiftDto,
  ): Promise<{ revealPath: string | null }> {
    if (pot.status !== 'open') {
      throw new ConflictException('This group gift can no longer be changed.');
    }
    const template = await this.gifts.findAvailableById(dto.giftTemplateId);
    const price = this.pricing.priceGift(
      template.base_price,
      template.delivery_type,
    );
    if (price.giftValue + price.deliveryFee > pot.amount_raised) {
      throw new BadRequestException(
        "The pot doesn't cover that gift yet. Pick one at or below what's been raised.",
      );
    }

    let orderId: string;
    try {
      orderId = await this.repository.switchGift(
        pot.id,
        template.id,
        price.giftValue,
        price.deliveryFee,
      );
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes('pot_does_not_cover_gift')) {
        throw new BadRequestException(
          "The pot doesn't cover that gift. Reload and try again.",
        );
      }
      if (message.includes('group_gift_not_open')) {
        throw new ConflictException(
          'This group gift can no longer be changed.',
        );
      }
      throw err;
    }

    this.funding.afterFunded(pot.id, orderId);
    // Any surplus above the new price is now owed back: send it now, not
    // at the next job tick.
    if (pot.amount_raised > price.giftValue + price.deliveryFee) {
      this.funding.kickRefunds();
    }
    const revealToken = await this.repository.orderRevealToken(orderId);
    return { revealPath: revealToken ? `/reveal/${revealToken}` : null };
  }

  async cancel(pot: GroupGiftRow): Promise<{ refunds: number }> {
    const owed = await this.repository.close(
      pot.id,
      'cancelled',
      'Cancelled by the organiser.',
      'user',
    );
    if (owed < 0) {
      throw new ConflictException(
        'Only a group gift that is still collecting can be cancelled.',
      );
    }
    this.funding.kickRefunds();
    return { refunds: owed };
  }

  /**
   * Everyone who chipped in, for the recipient. Names as each person
   * typed them; contributors who were refunded (late payments) are left
   * out, because they didn't end up paying for this gift.
   */
  async revealInfo(groupGiftId: string): Promise<GroupGiftRevealInfo | null> {
    const pot = await this.repository.findById(groupGiftId);
    if (!pot) return null;
    const [organiser, contributions] = await Promise.all([
      this.users.findById(pot.organiser_id),
      this.repository.contributions(pot.id),
    ]);
    const paid = contributions.filter((c) => c.status === 'confirmed');
    return {
      organiserName: organiser?.name ?? null,
      contributorCount: paid.length,
      contributors: paid.map((c) => ({
        name: c.contributor_name,
        message: c.message,
      })),
    };
  }
}

function remainingOf(pot: GroupGiftRow): number {
  if (pot.status !== 'open') return 0;
  return Math.max(0, pot.target_amount - pot.amount_raised);
}

function publicStatus(pot: GroupGiftRow): GroupGiftPublicView['status'] {
  if (pot.status === 'funded' || pot.status === 'triggered') return 'funded';
  if (pot.status !== 'open') return 'closed';
  return new Date(pot.deadline).getTime() <= Date.now()
    ? 'awaiting_organiser'
    : 'open';
}

function giftSummary(template: {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  delivery_type: string;
}): GiftSummary {
  return {
    giftTemplateId: template.id,
    name: template.name,
    description: template.description,
    imageUrl: template.image_url,
    deliveryType: template.delivery_type,
  };
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function parseFuture(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} isn't a valid date.`);
  }
  if (date.getTime() <= Date.now()) {
    throw new BadRequestException(`${field} must be in the future.`);
  }
  return date;
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err
    ? String(err.message)
    : String(err);
}
