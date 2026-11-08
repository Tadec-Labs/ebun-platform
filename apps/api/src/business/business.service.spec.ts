import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { BusinessGuard, type BusinessContext } from './business.guard';
import { BusinessService } from './business.service';
import type { CompanyRow, MemberRow } from './companies.repository';

const company: CompanyRow = {
  id: 'c1',
  display_name: 'PayGo',
  legal_name: null,
  billing_email: null,
  rc_number: null,
  tin: null,
  status: 'active',
  created_at: '2026-11-08T00:00:00Z',
};
const owner: MemberRow = {
  id: 'm1',
  company_id: 'c1',
  email: 'ada@paygo.ng',
  auth_id: 'a1',
  role: 'owner',
  accepted_at: '2026-11-08T00:00:00Z',
  created_at: '2026-11-08T00:00:00Z',
};
const memberRow: MemberRow = {
  ...owner,
  id: 'm2',
  email: 'tunde@paygo.ng',
  auth_id: 'a2',
  role: 'member',
};

function ctx(
  member: MemberRow | null,
  confirmed = true,
  authId = 'a1',
): BusinessContext {
  return {
    identity: {
      authId,
      email: member?.email ?? 'new@co.ng',
      emailConfirmed: confirmed,
    },
    member,
  };
}

function setup() {
  const companies = {
    company: jest.fn().mockResolvedValue(company),
    createWithOwner: jest.fn().mockResolvedValue('c9'),
    updateCompany: jest.fn(),
    members: jest
      .fn()
      .mockResolvedValue([owner, { ...memberRow, auth_id: null }]),
    invite: jest.fn().mockResolvedValue({ ...memberRow, auth_id: null }),
    removeMember: jest.fn().mockResolvedValue(true),
    campaigns: jest.fn().mockResolvedValue([]),
    campaign: jest.fn(),
  };
  const campaigns = {
    create: jest.fn().mockResolvedValue({ id: 'camp1', portal_token: 'tok-1' }),
  };
  const email = { send: jest.fn().mockResolvedValue('id') };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('https://app.ebun.com.ng') };
  const service = new BusinessService(
    companies as never,
    campaigns as never,
    email as never,
    audit as never,
    config as never,
  );
  return { service, companies, campaigns, email, audit };
}

describe('BusinessService', () => {
  it('creates a company with the caller as owner, only once their email is verified', async () => {
    const { service, companies } = setup();
    await expect(
      service.createCompany(ctx(null, false), { displayName: 'PayGo' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createCompany(ctx(null, true), { displayName: 'PayGo' }),
    ).resolves.toEqual({ id: 'c9' });
    expect(companies.createWithOwner).toHaveBeenCalledWith(
      'PayGo',
      'new@co.ng',
      'a1',
    );
  });

  it('refuses a second company for someone already in one', async () => {
    const { service } = setup();
    await expect(
      service.createCompany(ctx(owner), { displayName: 'Other' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('turns a taken email into a clear conflict', async () => {
    const { service, companies } = setup();
    companies.createWithOwner.mockRejectedValue({ code: '23505' });
    await expect(
      service.createCompany(ctx(null), { displayName: 'PayGo' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets only owners invite, and keeps the invite if the email fails', async () => {
    const { service, email } = setup();
    await expect(
      service.invite(ctx(memberRow, true, 'a2'), { email: 'x@paygo.ng' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    email.send.mockRejectedValue(new Error('down'));
    await expect(
      service.invite(ctx(owner), { email: 'X@PayGo.ng' }),
    ).resolves.toEqual({ id: 'm2', emailSent: false });
  });

  it('stops an owner removing themselves', async () => {
    const { service } = setup();
    await expect(service.removeMember(ctx(owner), 'm1')).rejects.toThrow(
      "can't remove yourself",
    );
  });

  it('creates campaigns under the company and hands back their link', async () => {
    const { service, campaigns } = setup();
    const result = await service.createCampaign(ctx(memberRow, true, 'a2'), {});
    expect(result).toEqual({ id: 'camp1', portalPath: '/company/tok-1' });
    expect(campaigns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: 'c1',
        company_name: 'PayGo',
        contact_email: 'tunde@paygo.ng',
      }),
    );
  });

  it("won't open another company's campaign", async () => {
    const { service, companies } = setup();
    companies.campaign.mockResolvedValue(null);
    await expect(
      service.openCampaign(ctx(owner), 'camp-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks a suspended company', async () => {
    const { service, companies } = setup();
    companies.company.mockResolvedValue({ ...company, status: 'suspended' });
    await expect(service.listCampaigns(ctx(owner))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('BusinessGuard', () => {
  function run(opts: {
    enabled?: boolean;
    header?: string;
    identity?: unknown;
    member?: MemberRow | null;
    accepted?: MemberRow | null;
  }) {
    const auth = {
      verifyAccessToken: jest.fn().mockResolvedValue(opts.identity ?? null),
    };
    const companies = {
      memberByAuthId: jest.fn().mockResolvedValue(opts.member ?? null),
      acceptInvite: jest.fn().mockResolvedValue(opts.accepted ?? null),
    };
    const config = {
      get: jest
        .fn()
        .mockReturnValue(opts.enabled === false ? undefined : 'true'),
    };
    const guard = new BusinessGuard(
      auth as never,
      companies as never,
      config as never,
    );
    const request: Record<string, unknown> = {
      headers: opts.header ? { authorization: opts.header } : {},
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, context, request, companies };
  }

  it('is off without the self-serve flag', async () => {
    const { guard, context } = run({ enabled: false, header: 'Bearer t' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a missing or invalid token', async () => {
    const { guard, context } = run({ header: 'Bearer bad' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('claims a pending invite only for a verified email', async () => {
    const unverified = run({
      header: 'Bearer t',
      identity: {
        authId: 'a2',
        email: 'Tunde@PayGo.ng',
        emailConfirmed: false,
      },
      accepted: memberRow,
    });
    await unverified.guard.canActivate(unverified.context);
    expect(unverified.companies.acceptInvite).not.toHaveBeenCalled();

    const verified = run({
      header: 'Bearer t',
      identity: { authId: 'a2', email: 'Tunde@PayGo.ng', emailConfirmed: true },
      accepted: memberRow,
    });
    await verified.guard.canActivate(verified.context);
    expect(verified.companies.acceptInvite).toHaveBeenCalledWith(
      'tunde@paygo.ng',
      'a2',
    );
    expect((verified.request.business as BusinessContext).member).toEqual(
      memberRow,
    );
  });
});
