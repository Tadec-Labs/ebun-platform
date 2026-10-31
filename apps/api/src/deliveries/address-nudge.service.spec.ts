import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import { AddressNudgeService } from './address-nudge.service';
import {
  AwaitingAddressRow,
  DeliveriesRepository,
} from './deliveries.repository';

const NOW = new Date('2026-10-24T12:00:00Z');
const HOURS = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

function row(overrides: Partial<AwaitingAddressRow> = {}): AwaitingAddressRow {
  return {
    id: 'order-1',
    sender_name: null,
    recipient_name: 'Kachi Obi',
    recipient_phone: '+2348031234567',
    reveal_token: 'tok-123',
    address_nudges: 0,
    created_at: HOURS(25),
    expires_at: '2026-11-20T00:00:00Z',
    gift_templates: { name: 'Grocery Hamper' },
    users: { email: 'tolu@example.com', name: 'Tolu Ade' },
    ...overrides,
  };
}

describe('AddressNudgeService', () => {
  let repo: { awaitingAddress: jest.Mock; recordAddressNudge: jest.Mock };
  let email: { isConfigured: jest.Mock; send: jest.Mock };
  let sut: AddressNudgeService;

  beforeEach(() => {
    repo = {
      awaitingAddress: jest.fn().mockResolvedValue([row()]),
      recordAddressNudge: jest.fn().mockResolvedValue(true),
    };
    email = {
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue('msg'),
    };
    sut = new AddressNudgeService(
      repo as unknown as DeliveriesRepository,
      email as unknown as EmailSenderService,
      {
        get: () => 'https://app.ebun.com.ng/',
      } as unknown as ConfigService,
    );
  });

  const sent = () => email.send.mock.calls as [{ to: string; text: string }][];

  it('on day 1, emails the sender a one-tap WhatsApp resend of the link', async () => {
    await expect(sut.nudgeDue(NOW)).resolves.toBe(1);

    expect(repo.recordAddressNudge).toHaveBeenCalledWith('order-1', 0);
    const [message] = sent()[0];
    expect(message.to).toBe('tolu@example.com');
    expect(message.text).toContain('https://wa.me/2348031234567?text=');
    expect(message.text).toContain('https://app.ebun.com.ng/reveal/tok-123');
  });

  it('greets the sender by the name typed for this gift, not the one saved with their email', async () => {
    repo.awaitingAddress.mockResolvedValue([row({ sender_name: 'Theo' })]);

    await sut.nudgeDue(NOW);

    expect(sent()[0][0].text).toMatch(/^Hi Theo,/);
  });

  it('waits until day 3 for the second nudge', async () => {
    repo.awaitingAddress.mockResolvedValue([
      row({ address_nudges: 1, created_at: HOURS(48) }),
    ]);
    await expect(sut.nudgeDue(NOW)).resolves.toBe(0);

    repo.awaitingAddress.mockResolvedValue([
      row({ address_nudges: 1, created_at: HOURS(73) }),
    ]);
    await expect(sut.nudgeDue(NOW)).resolves.toBe(1);
  });

  it('sends nothing when another instance already claimed the nudge', async () => {
    repo.recordAddressNudge.mockResolvedValue(false);

    await expect(sut.nudgeDue(NOW)).resolves.toBe(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('skips expired gifts and senders with no email', async () => {
    repo.awaitingAddress.mockResolvedValue([
      row({ expires_at: HOURS(1) }),
      row({ id: 'order-2', users: { email: null, name: null } }),
    ]);

    await expect(sut.nudgeDue(NOW)).resolves.toBe(0);
    expect(repo.recordAddressNudge).not.toHaveBeenCalled();
  });
});
