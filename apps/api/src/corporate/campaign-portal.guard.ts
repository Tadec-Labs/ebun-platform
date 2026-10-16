import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CampaignRow } from './campaigns.repository';
import { CampaignsRepository } from './campaigns.repository';

export interface CampaignRequest extends Request {
  campaign?: CampaignRow;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authenticates a company's campaign link. Same model as the vendor
 * counter link (see 20261009180000_vendor_portal_access.sql): a
 * rotatable, high-entropy token that the web app moves from the URL into
 * an httpOnly cookie on first open, then sends as a bearer header.
 *
 * Scope is one campaign — its list, its gifts, its report. A cancelled
 * campaign's link stops working.
 */
@Injectable()
export class CampaignPortalGuard implements CanActivate {
  constructor(private readonly campaigns: CampaignsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CampaignRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Campaign link is missing or invalid.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!UUID_PATTERN.test(token)) {
      throw new UnauthorizedException('Campaign link is missing or invalid.');
    }
    const campaign = await this.campaigns.findByPortalToken(token);
    if (!campaign || campaign.status === 'cancelled') {
      throw new UnauthorizedException('Campaign link is missing or invalid.');
    }
    request.campaign = campaign;
    return true;
  }
}

export function campaignOf(request: CampaignRequest): CampaignRow {
  if (!request.campaign) {
    throw new UnauthorizedException('Campaign link is missing or invalid.');
  }
  return request.campaign;
}
