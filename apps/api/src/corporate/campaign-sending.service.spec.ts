import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import { AuditService } from '../audit/audit.service';
import { CampaignRow, CampaignsRepository } from './campaigns.repository';
import { CampaignSendingService } from './campaign-sending.service';

const CAMPAIGN = {
  id: 'c1',
  status: 'paid',
  company_name: 'Acme Ltd',
  sender_display_name: 'Ada Obi, CEO',
  title: 'Thank you for 2026',
  send_at: null,
  links_sent_at: null,
} as unknown as CampaignRow;

describe('CampaignSendingService', () => {
  let repo: Record<string, jest.Mock>;
  let email: { isConfigured: jest.Mock; send: jest.Mock };
  let sut: CampaignSendingService;

  beforeEach(() => {
    repo = {
      recipients: jest.fn().mockResolvedValue([
        {
          id: 'r1',
          name: 'Bola Ade',
          phone: '+2348031234567',
          email: 'bola@acme.ng',
          note: 'Finance',
          order_id: 'o1',
          link_sent_at: null,
        },
        {
          id: 'r2',
          name: 'Chi',
          phone: '+2348031234568',
          email: null,
          note: null,
          order_id: 'o2',
          link_sent_at: null,
        },
        {
          id: 'r3',
          name: 'Done',
          phone: '+2348031234569',
          email: 'd@acme.ng',
          note: null,
          order_id: 'o3',
          link_sent_at: 't',
        },
        {
          id: 'r4',
          name: '=HYPERLINK("x")',
          phone: '+2348031234570',
          email: 'e@acme.ng',
          note: null,
          order_id: 'o4',
          link_sent_at: null,
        },
      ]),
      orders: jest.fn().mockResolvedValue([
        { id: 'o1', reveal_token: 'tok-1', expires_at: '2027-01-15T00:00:00Z' },
        { id: 'o2', reveal_token: 'tok-2', expires_at: '2027-01-15T00:00:00Z' },
        { id: 'o3', reveal_token: 'tok-3', expires_at: '2027-01-15T00:00:00Z' },
        { id: 'o4', reveal_token: 'tok-4', expires_at: '2027-01-15T00:00:00Z' },
      ]),
      markLinkSent: jest.fn().mockResolvedValue(undefined),
      markLinksSent: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(CAMPAIGN),
      campaignsDueToSend: jest.fn().mockResolvedValue([CAMPAIGN]),
    };
    email = {
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue('msg-1'),
    };
    sut = new CampaignSendingService(
      repo as unknown as CampaignsRepository,
      email as unknown as EmailSenderService,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditService,
      { get: () => 'https://app.ebun.com.ng/' } as unknown as ConfigService,
    );
    sut.spacingMs = 0;
  });

  it('emails each person their own link once, and counts the ones HR must share', async () => {
    const outcome = await sut.send(CAMPAIGN, 'scheduled');

    expect(outcome).toEqual({ emailed: 2, failed: 0, noEmail: 1 });
    const sent = (
      email.send.mock.calls[0] as [
        { to: string; subject: string; text: string },
      ]
    )[0];
    expect(sent.to).toBe('bola@acme.ng');
    expect(sent.subject).toBe('Acme Ltd: a gift for you');
    const text = sent.text;
    expect(text).toContain('https://app.ebun.com.ng/reveal/tok-1');
    expect(text).toContain('Hi Bola,');
    expect(text).toContain('Ada Obi, CEO at Acme Ltd');
    expect(repo.markLinkSent).toHaveBeenCalledWith('r1', null);
    expect(repo.markLinksSent).toHaveBeenCalledWith('c1');
  });

  it('records a failed email against the person, and carries on', async () => {
    email.send.mockRejectedValueOnce(new Error('Resend 429: rate limited'));
    const outcome = await sut.send(CAMPAIGN, 'scheduled');
    expect(outcome.failed).toBe(1);
    expect(outcome.emailed).toBe(1);
    expect(repo.markLinkSent).toHaveBeenCalledWith(
      'r1',
      'Resend 429: rate limited',
    );
  });

  it("doesn't send for a campaign that isn't paid", async () => {
    await sut.send({ ...CAMPAIGN, status: 'draft' }, 'scheduled');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('waits for a future send time', async () => {
    repo.findById.mockResolvedValue({
      ...CAMPAIGN,
      send_at: '2099-12-24T08:00:00Z',
    });
    await sut.sendIfDue('c1');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('builds a link sheet with everyone, safe to open in Excel', async () => {
    const csv = await sut.linkSheet(CAMPAIGN);
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(lines[0]).toBe('Name,Phone,Email,Note,Gift link,Claim by');
    expect(lines[1]).toBe(
      'Bola Ade,+2348031234567,bola@acme.ng,Finance,https://app.ebun.com.ng/reveal/tok-1,2027-01-15',
    );
    // A name starting with = is never run as a formula.
    expect(lines[4].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
  });
});
