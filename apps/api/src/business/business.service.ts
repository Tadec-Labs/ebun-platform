import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import { AuditService } from '../audit/audit.service';
import { CampaignsRepository } from '../corporate/campaigns.repository';
import type { BusinessContext } from './business.guard';
import {
  CompaniesRepository,
  isUniqueViolation,
  type CompanyRow,
  type MemberRow,
} from './companies.repository';
import type {
  CreateBusinessCampaignDto,
  CreateCompanyDto,
  InviteMemberDto,
  UpdateCompanyDto,
} from './dto/business.dto';

/** The self-serve campaign fee, as before (10%). The flat per-treat fee arrives with the company balance. */
const COMPANY_FEE_BPS = 1000;

interface Acting {
  member: MemberRow;
  company: CompanyRow;
}

/**
 * Company accounts: the company, its people and its campaigns.
 *
 * A campaign made here is an ordinary campaign with company_id set.
 * Editing, paying and sending still happen in the existing campaign
 * screen, reached through the campaign's portal link — a signed-in
 * member is simply handed that link instead of having it emailed. One
 * campaign engine, two front doors.
 */
@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly companies: CompaniesRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly email: EmailSenderService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async me(ctx: BusinessContext) {
    const acting = ctx.member ? await this.acting(ctx) : null;
    return {
      email: ctx.identity.email,
      emailConfirmed: ctx.identity.emailConfirmed,
      company: acting ? this.companyView(acting.company) : null,
      role: acting?.member.role ?? null,
    };
  }

  async createCompany(ctx: BusinessContext, dto: CreateCompanyDto) {
    if (ctx.member)
      throw new ConflictException('You already belong to a company.');
    if (!ctx.identity.emailConfirmed) {
      throw new ForbiddenException('Verify your email address first.');
    }
    let companyId: string;
    try {
      companyId = await this.companies.createWithOwner(
        dto.displayName,
        ctx.identity.email,
        ctx.identity.authId,
      );
    } catch (err) {
      // A pending invite for this email exists in another company: the
      // guard didn't claim it only if the email was unverified, which we
      // checked above, so this is a genuine "already in a company".
      if (isUniqueViolation(err)) {
        throw new ConflictException('This email already belongs to a company.');
      }
      throw err;
    }
    await this.audit.record({
      eventType: 'company.created',
      actorId: ctx.identity.authId,
      actorType: 'user',
      resourceType: 'company',
      resourceId: companyId,
      metadata: { displayName: dto.displayName },
    });
    return { id: companyId };
  }

  async updateCompany(ctx: BusinessContext, dto: UpdateCompanyDto) {
    const { member, company } = await this.requireOwner(ctx);
    const fields: Parameters<CompaniesRepository['updateCompany']>[1] = {};
    if (dto.displayName !== undefined) fields.display_name = dto.displayName;
    if (dto.legalName !== undefined) fields.legal_name = dto.legalName;
    if (dto.billingEmail !== undefined) {
      fields.billing_email = dto.billingEmail?.toLowerCase() ?? null;
    }
    if (dto.rcNumber !== undefined) fields.rc_number = dto.rcNumber;
    if (dto.tin !== undefined) fields.tin = dto.tin;
    if (Object.keys(fields).length === 0) return this.companyView(company);

    const updated = await this.companies.updateCompany(company.id, fields);
    await this.audit.record({
      eventType: 'company.updated',
      actorId: member.id,
      actorType: 'user',
      resourceType: 'company',
      resourceId: company.id,
      metadata: { fields: Object.keys(fields) },
    });
    return this.companyView(updated);
  }

  async members(ctx: BusinessContext) {
    const { company } = await this.requireMember(ctx);
    const rows = await this.companies.members(company.id);
    return rows.map((m) => ({
      id: m.id,
      email: m.email,
      role: m.role,
      pending: m.auth_id === null,
      you: m.auth_id === ctx.identity.authId,
    }));
  }

  async invite(ctx: BusinessContext, dto: InviteMemberDto) {
    const { member, company } = await this.requireOwner(ctx);
    const email = dto.email.toLowerCase();
    let invited: MemberRow;
    try {
      invited = await this.companies.invite(company.id, email, member.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'That address already belongs to a company, or has a pending invite.',
        );
      }
      throw err;
    }
    await this.audit.record({
      eventType: 'company.member_invited',
      actorId: member.id,
      actorType: 'user',
      resourceType: 'company',
      resourceId: company.id,
      metadata: { memberId: invited.id },
    });

    // The invite stands even if the email fails: the person can still
    // sign up with this address and land in the company.
    let emailSent = true;
    try {
      await this.email.send({
        to: email,
        subject: `Join ${company.display_name} on SendEbun`,
        text: inviteText(
          company.display_name,
          ctx.identity.email,
          this.webUrl('/business/signup'),
        ),
      });
    } catch (err) {
      emailSent = false;
      this.logger.warn(
        `Invite ${invited.id}: email failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { id: invited.id, emailSent };
  }

  async removeMember(ctx: BusinessContext, memberId: string) {
    const { member, company } = await this.requireOwner(ctx);
    if (memberId === member.id) {
      throw new BadRequestException("You can't remove yourself.");
    }
    const removed = await this.companies.removeMember(company.id, memberId);
    if (!removed) throw new NotFoundException();
    await this.audit.record({
      eventType: 'company.member_removed',
      actorId: member.id,
      actorType: 'user',
      resourceType: 'company',
      resourceId: company.id,
      metadata: { memberId },
    });
    return { removed: true };
  }

  async listCampaigns(ctx: BusinessContext) {
    const { company } = await this.requireMember(ctx);
    const rows = await this.companies.campaigns(company.id);
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      recipients: c.recipients_count,
      amountDue: c.amount_due,
      sendAt: c.send_at,
      paidAt: c.paid_at,
      createdAt: c.created_at,
    }));
  }

  async createCampaign(ctx: BusinessContext, dto: CreateBusinessCampaignDto) {
    const { member, company } = await this.requireMember(ctx);
    const campaign = await this.campaigns.create({
      company_id: company.id,
      company_name: company.display_name,
      // The campaign record still carries a contact; for account
      // campaigns it's whoever made it.
      contact_name: company.display_name,
      contact_email: ctx.identity.email,
      contact_phone: null,
      title: dto.title ?? 'A thank-you from us',
      fee_bps: COMPANY_FEE_BPS,
      created_by: null,
    });
    await this.audit.record({
      eventType: 'campaign.created',
      actorId: member.id,
      actorType: 'user',
      resourceType: 'campaign',
      resourceId: campaign.id,
      metadata: {
        companyId: company.id,
        feeBps: COMPANY_FEE_BPS,
        via: 'business_account',
      },
    });
    return { id: campaign.id, portalPath: `/company/${campaign.portal_token}` };
  }

  /**
   * Hands a member the campaign's own link, which the web app turns into
   * the campaign screen's cookie. Only for this company's campaigns.
   */
  async openCampaign(ctx: BusinessContext, campaignId: string) {
    const { company } = await this.requireMember(ctx);
    const campaign = await this.companies.campaign(company.id, campaignId);
    if (!campaign || campaign.status === 'cancelled')
      throw new NotFoundException();
    return { portalPath: `/company/${campaign.portal_token}` };
  }

  private async acting(ctx: BusinessContext): Promise<Acting | null> {
    if (!ctx.member) return null;
    const company = await this.companies.company(ctx.member.company_id);
    if (!company) return null;
    return { member: ctx.member, company };
  }

  private async requireMember(ctx: BusinessContext): Promise<Acting> {
    const acting = await this.acting(ctx);
    if (!acting)
      throw new ForbiddenException('Create or join a company first.');
    if (acting.company.status !== 'active') {
      throw new ForbiddenException('This company account is suspended.');
    }
    return acting;
  }

  private async requireOwner(ctx: BusinessContext): Promise<Acting> {
    const acting = await this.requireMember(ctx);
    if (acting.member.role !== 'owner') {
      throw new ForbiddenException('Only an owner can do that.');
    }
    return acting;
  }

  private companyView(c: CompanyRow) {
    return {
      id: c.id,
      displayName: c.display_name,
      legalName: c.legal_name,
      billingEmail: c.billing_email,
      rcNumber: c.rc_number,
      tin: c.tin,
      status: c.status,
    };
  }

  private webUrl(path: string): string {
    const base = (this.config.get<string>('WEB_APP_BASE_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return `${base}${path}`;
  }
}

function inviteText(
  company: string,
  inviter: string,
  signupUrl: string,
): string {
  return [
    `${inviter} invited you to ${company} on SendEbun.`,
    '',
    'Create your sign-in with this email address to join:',
    signupUrl,
    '',
    "If you weren't expecting this, you can ignore it.",
  ].join('\n');
}
