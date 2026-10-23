import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import { AuditService } from '../audit/audit.service';
import { CampaignRow, CampaignsRepository } from './campaigns.repository';
import { CampaignsService } from './campaigns.service';
import {
  ResendCompanyLinksDto,
  StartCompanyCampaignDto,
} from './dto/company-signup.dto';

/** One answer for every outcome, so the form can't be used to learn who has an account. */
export interface SignupAnswer {
  sent: true;
}

/**
 * Past this many unpaid drafts, an address gets its existing links again
 * instead of another new campaign: someone pressing the button five
 * times, or a bot, doesn't fill ops' list with empty drafts.
 */
const MAX_OPEN_DRAFTS = 3;

/** SendEbun's default fee for companies that sign themselves up (10%). Ops can change it per campaign. */
const SELF_SERVE_FEE_BPS = 1000;

/**
 * Companies starting a campaign themselves, without waiting for ops.
 *
 * THE KEY DECISION: the private link is EMAILED, never shown on screen.
 * The link is the company's whole credential (it can edit the list and
 * pay), so it goes only to the address typed in. That proves the person
 * controls that inbox, means nobody can start a campaign "as" another
 * company and land in it, and keeps the link out of shared screens and
 * browser history. Everything after the email is the existing portal —
 * this adds a front door, not a second system.
 *
 * Every response is the same "check your email", whether a campaign was
 * created, an existing link resent, or the honeypot tripped, so the form
 * can't be used to find out which addresses have campaigns.
 */
@Injectable()
export class CompanySignupService {
  private readonly logger = new Logger(CompanySignupService.name);

  constructor(
    private readonly repository: CampaignsRepository,
    private readonly campaigns: CampaignsService,
    private readonly email: EmailSenderService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('CORPORATE_SELF_SERVE') === 'true';
  }

  async start(dto: StartCompanyCampaignDto): Promise<SignupAnswer> {
    if (dto.website) return { sent: true };
    const email = dto.contactEmail.toLowerCase();

    const open = await this.repository.findOpenByContactEmail(email);
    const drafts = open.filter((c) => c.status === 'draft');
    if (drafts.length >= MAX_OPEN_DRAFTS) {
      await this.sendLinks(email, open);
      return { sent: true };
    }

    const campaign = await this.repository.create({
      company_name: dto.companyName,
      contact_name: dto.contactName,
      contact_email: email,
      contact_phone: dto.contactPhone ?? null,
      title: 'A thank-you from us',
      fee_bps: SELF_SERVE_FEE_BPS,
      created_by: null,
    });
    await this.audit.record({
      eventType: 'campaign.created',
      actorId: null,
      actorType: 'user',
      resourceType: 'campaign',
      resourceId: campaign.id,
      metadata: {
        companyName: campaign.company_name,
        feeBps: campaign.fee_bps,
        via: 'self_serve',
      },
    });

    try {
      await this.email.send({
        to: email,
        subject: `Your SendEbun gifting link for ${campaign.company_name}`,
        text: welcomeText(campaign, this.campaigns.portalUrl(campaign)),
      });
    } catch (err) {
      this.logger.error(
        `Self-serve campaign ${campaign.id}: welcome email failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        "We couldn't email your link just now. Please try again in a minute.",
      );
    }

    await this.tellOps(campaign);
    return { sent: true };
  }

  async resendLinks(dto: ResendCompanyLinksDto): Promise<SignupAnswer> {
    if (dto.website) return { sent: true };
    const email = dto.email.toLowerCase();
    const open = await this.repository.findOpenByContactEmail(email);
    if (open.length > 0) await this.sendLinks(email, open);
    return { sent: true };
  }

  private async sendLinks(email: string, open: CampaignRow[]): Promise<void> {
    const lines = open.map(
      (c) =>
        `${c.company_name} — "${c.title}" (${STATUS_WORDS[c.status] ?? c.status})\n${this.campaigns.portalUrl(c)}`,
    );
    try {
      await this.email.send({
        to: email,
        subject: 'Your SendEbun gifting links',
        text: [
          'Here are the gifting campaigns for this email address:',
          '',
          lines.join('\n\n'),
          '',
          'Each link is private: anyone with it can change and pay for that campaign, so please don’t forward it.',
          '',
          'SendEbun',
        ].join('\n'),
      });
    } catch (err) {
      // Logged, not thrown: the answer is the same either way, and a
      // failure here must not reveal that the address has campaigns.
      this.logger.error(
        `Resending company links failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Best effort: ops hears about every new company the moment it signs up. */
  private async tellOps(campaign: CampaignRow): Promise<void> {
    const to = this.config.get<string>('OPS_ALERT_EMAIL')?.trim();
    if (!to) return;
    try {
      await this.email.send({
        to,
        subject: `New company signed up: ${campaign.company_name}`,
        text: [
          `${campaign.company_name} started a gifting campaign on their own.`,
          '',
          `Contact: ${campaign.contact_name}`,
          `Email: ${campaign.contact_email}`,
          `Phone: ${campaign.contact_phone ?? '—'}`,
          `Fee: ${campaign.fee_bps / 100}%`,
          '',
          'It is in /ops → Campaigns. A quick call today is worth it.',
        ].join('\n'),
      });
    } catch (err) {
      this.logger.warn(
        `Ops alert for campaign ${campaign.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

const STATUS_WORDS: Record<string, string> = {
  draft: 'being set up',
  awaiting_payment: 'waiting for payment',
  paid: 'paid',
};

function welcomeText(campaign: CampaignRow, link: string): string {
  const first = campaign.contact_name.split(' ')[0];
  return [
    `Hi ${first},`,
    '',
    `Here is your private link to set up ${campaign.company_name}'s gifts:`,
    link,
    '',
    'On it you can:',
    '1. Upload your list (a spreadsheet or pasted names and phone numbers).',
    '2. Record one message — voice, video or written.',
    '3. Pick up to three gifts; each person chooses the one they want.',
    '4. Choose when the gifts go out, and pay once.',
    '',
    'Afterwards the same link shows who opened, who enjoyed their gift and their thank-you notes.',
    '',
    'Keep this link private: anyone who has it can change and pay for your campaign. Lost it? Ask for it again at the same page.',
    '',
    'Questions? Reply to hello@ebun.com.ng.',
    '',
    'SendEbun',
  ].join('\n');
}
