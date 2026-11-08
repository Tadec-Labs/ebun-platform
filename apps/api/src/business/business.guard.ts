import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService, type VerifiedIdentity } from '../auth/auth.service';
import { CompaniesRepository, type MemberRow } from './companies.repository';

export interface BusinessContext {
  identity: VerifiedIdentity & { email: string };
  /** Null when this person has signed in but has no company yet. */
  member: MemberRow | null;
}

export type BusinessRequest = Request & { business?: BusinessContext };

/**
 * Who is calling, and which company they belong to.
 *
 * The bearer token is a Supabase access token (the web app keeps it in
 * an httpOnly cookie, as /ops does). A valid token is not membership:
 * membership comes from company_members. On first sign-in a pending
 * invite for this email is claimed — but only once the email is
 * verified, or anyone could sign up as an invited address and walk into
 * that company.
 *
 * Unlike StaffGuard this lets a member-less person through (member =
 * null): they need to reach "create your company". Every route that
 * acts on a company checks membership itself (BusinessService.require*).
 *
 * Off unless CORPORATE_SELF_SERVE=true, like the rest of self-serve.
 */
@Injectable()
export class BusinessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly companies: CompaniesRepository,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<string>('CORPORATE_SELF_SERVE') !== 'true') {
      throw new NotFoundException();
    }
    const request = context.switchToHttp().getRequest<BusinessRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();

    const identity = await this.auth.verifyAccessToken(
      header.slice('Bearer '.length).trim(),
    );
    if (!identity?.email) throw new UnauthorizedException();
    const email = identity.email.toLowerCase();

    let member = await this.companies.memberByAuthId(identity.authId);
    if (!member && identity.emailConfirmed) {
      member = await this.companies.acceptInvite(email, identity.authId);
    }

    request.business = { identity: { ...identity, email }, member };
    return true;
  }
}
