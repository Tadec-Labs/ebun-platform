import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import { AuditService } from '../audit/audit.service';
import { CampaignRow, CampaignsRepository } from './campaigns.repository';
import { CampaignsService } from './campaigns.service';
import { CompanySignupService } from './company-signup.service';

function campaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: '5f0c8a8e-2b7d-4c41-9a0e-3d5b7c1e2f40',
    lead_id: null,
    company_name: 'Acme Ltd',
    contact_name: 'Ada Obi',
    contact_email: 'ada@acme.ng',
    contact_phone: '+2348031234567',
    title: 'A thank-you from us',
    sender_display_name: null,
    message_text: null,
    message_type: 'text',
    message_url: null,
    message_duration_secs: null,
    send_at: null,
    gift_days: 30,
    fee_bps: 1000,
    status: 'draft',
    portal_token: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    recipients_count: null,
    seat_price: null,
    gift_total: null,
    fee_amount: null,
    amount_due: null,
    paystack_reference: null,
    paid_at: null,
    links_sent_at: null,
    created_at: '2026-10-23T09:00:00Z',
    updated_at: '2026-10-23T09:00:00Z',
    ...overrides,
  };
}

const calls = (mock: jest.Mock): unknown[][] => mock.mock.calls as unknown[][];

describe('CompanySignupService', () => {
  let repository: {
    findOpenByContactEmail: jest.Mock;
    create: jest.Mock;
  };
  let email: { send: jest.Mock };
  let audit: { record: jest.Mock };
  let env: Record<string, string | undefined>;
  let sut: CompanySignupService;

  const input = {
    companyName: 'Acme Ltd',
    contactName: 'Ada Obi',
    contactEmail: 'Ada@Acme.ng',
    contactPhone: '+2348031234567',
  };

  beforeEach(() => {
    repository = {
      findOpenByContactEmail: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation((row: Partial<CampaignRow>) =>
          Promise.resolve(campaign(row)),
        ),
    };
    email = { send: jest.fn().mockResolvedValue('msg_1') };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    env = { OPS_ALERT_EMAIL: 'ops@ebun.com.ng', CORPORATE_SELF_SERVE: 'true' };
    const campaigns = {
      portalUrl: (c: CampaignRow) =>
        `https://app.ebun.com.ng/company/${c.portal_token}`,
    };
    sut = new CompanySignupService(
      repository as unknown as CampaignsRepository,
      campaigns as unknown as CampaignsService,
      email as unknown as EmailSenderService,
      audit as unknown as AuditService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );
  });

  const sentTo = () =>
    calls(email.send).map((c) => (c[0] as { to: string }).to);
  const bodyOf = (i: number) =>
    (calls(email.send)[i][0] as { text: string }).text;

  it('is off unless CORPORATE_SELF_SERVE is "true"', () => {
    expect(sut.isEnabled()).toBe(true);
    env.CORPORATE_SELF_SERVE = undefined;
    expect(sut.isEnabled()).toBe(false);
  });

  it('creates a draft at the default 10% fee, emails the private link to the contact only, and tells ops', async () => {
    await expect(sut.start(input)).resolves.toEqual({ sent: true });

    const created = calls(repository.create)[0][0] as Partial<CampaignRow>;
    expect(created).toMatchObject({
      contact_email: 'ada@acme.ng',
      fee_bps: 1000,
      created_by: null,
    });
    expect(sentTo()).toEqual(['ada@acme.ng', 'ops@ebun.com.ng']);
    expect(bodyOf(0)).toContain(
      'https://app.ebun.com.ng/company/9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    );
    // The link is the company's credential: never in the ops alert.
    expect(bodyOf(1)).not.toContain('/company/');
    const event = calls(audit.record)[0][0] as {
      eventType: string;
      metadata: { via: string };
    };
    expect(event.eventType).toBe('campaign.created');
    expect(event.metadata.via).toBe('self_serve');
  });

  it('answers a filled honeypot exactly like success, and does nothing', async () => {
    await expect(sut.start({ ...input, website: 'spam' })).resolves.toEqual({
      sent: true,
    });
    expect(repository.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('after three unpaid drafts, resends the existing links instead of making another', async () => {
    repository.findOpenByContactEmail.mockResolvedValue([
      campaign({ id: 'a' }),
      campaign({ id: 'b' }),
      campaign({ id: 'c' }),
    ]);

    await expect(sut.start(input)).resolves.toEqual({ sent: true });

    expect(repository.create).not.toHaveBeenCalled();
    expect(sentTo()).toEqual(['ada@acme.ng']);
    expect(calls(email.send)[0][0]).toMatchObject({
      subject: 'Your SendEbun gifting links',
    });
  });

  it('says so when the link email cannot be sent, so they can try again', async () => {
    email.send.mockRejectedValueOnce(new Error('Resend 500'));

    await expect(sut.start(input)).rejects.toThrow(ServiceUnavailableException);
  });

  it('gives the same answer for an address with no campaigns, and sends nothing', async () => {
    await expect(sut.resendLinks({ email: 'nobody@x.ng' })).resolves.toEqual({
      sent: true,
    });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('emails every open link for an address that has some, without revealing failures', async () => {
    repository.findOpenByContactEmail.mockResolvedValue([
      campaign({ status: 'paid' }),
    ]);
    email.send.mockRejectedValueOnce(new Error('Resend down'));

    await expect(sut.resendLinks({ email: 'ADA@acme.ng' })).resolves.toEqual({
      sent: true,
    });
    expect(repository.findOpenByContactEmail).toHaveBeenCalledWith(
      'ada@acme.ng',
    );
  });
});
