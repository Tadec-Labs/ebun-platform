import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignFundingService } from './campaign-funding.service';

/** What the reveal page shows for a gift sent by a company. */
export interface CampaignRevealInfo {
  companyName: string;
  /** "Ada Obi, CEO" — or null, and the company name is used. */
  senderDisplayName: string | null;
  title: string;
  /** Set while the recipient still has to pick (choice campaigns). */
  choices:
    | {
        giftTemplateId: string;
        name: string;
        description: string | null;
        imageUrl: string | null;
        deliveryType: string;
      }[]
    | null;
  /** They already sent their thank-you. */
  thanked: boolean;
}

/**
 * The recipient's side of a company gift: picking one of the company's
 * options, and saying thank you. Reached only through the reveal token,
 * by RevealService.
 */
@Injectable()
export class CampaignGiftsService {
  private readonly logger = new Logger(CampaignGiftsService.name);

  constructor(
    private readonly repository: CampaignsRepository,
    private readonly gifts: GiftsService,
    private readonly funding: CampaignFundingService,
    private readonly audit: AuditService,
  ) {}

  async revealInfo(order: {
    id: string;
    campaign_id?: unknown;
    status: string;
    gift_chosen_at?: unknown;
  }): Promise<CampaignRevealInfo | null> {
    if (typeof order.campaign_id !== 'string') return null;
    const [campaign, recipient] = await Promise.all([
      this.repository.revealInfo(order.campaign_id),
      this.repository.recipientByOrder(order.id),
    ]);
    if (!campaign) return null;

    let choices: CampaignRevealInfo['choices'] = null;
    if (order.status === 'paid' && !order.gift_chosen_at) {
      const options = await this.repository.options(order.campaign_id);
      choices = [];
      for (const option of options) {
        const template = await this.gifts.findById(option.gift_template_id);
        choices.push({
          giftTemplateId: template.id,
          name: template.name,
          description: template.description,
          imageUrl: template.image_url,
          deliveryType: template.delivery_type,
        });
      }
    }
    return {
      companyName: campaign.company_name,
      senderDisplayName: campaign.sender_display_name,
      title: campaign.title,
      choices,
      thanked: Boolean(recipient?.thanks_at),
    };
  }

  /**
   * The recipient picks. One conditional UPDATE decides it
   * (choose_campaign_gift): a second tap, or a forwarded link racing the
   * real recipient, finds it already chosen. Then the gift is fulfilled
   * straight away, so the page they land on has it ready.
   */
  async choose(
    order: { id: string; campaign_id?: unknown },
    giftTemplateId: string,
  ): Promise<void> {
    if (typeof order.campaign_id !== 'string') {
      throw new BadRequestException('This gift has nothing to choose.');
    }
    const chosen = await this.repository.chooseGift(order.id, giftTemplateId);
    if (!chosen) {
      throw new ConflictException(
        "This gift has already been chosen, or that isn't one of the options. Reload the page.",
      );
    }
    await this.audit.record({
      eventType: 'order.campaign_gift_chosen',
      actorId: null,
      actorType: 'user',
      resourceType: 'order',
      resourceId: order.id,
      metadata: { campaignId: order.campaign_id, giftTemplateId },
    });
    if (!(await this.funding.fulfilOrder(order.id))) {
      // The choice stands; the sweep job will start it within minutes.
      this.logger.warn(
        `Order ${order.id}: chosen, fulfilment left to the sweep.`,
      );
    }
  }

  async thank(
    order: { id: string; campaign_id?: unknown },
    note: string,
  ): Promise<void> {
    if (typeof order.campaign_id !== 'string') {
      throw new BadRequestException(
        'Thank-you notes are for gifts from a company.',
      );
    }
    if (!(await this.repository.saveThanks(order.id, note))) {
      throw new ConflictException(
        'You have already said thank you for this gift.',
      );
    }
  }
}
