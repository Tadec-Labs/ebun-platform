import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { GroupGiftRow } from './group-gifts.repository';
import { GroupGiftsRepository } from './group-gifts.repository';

export interface OrganiserRequest extends Request {
  groupGift?: GroupGiftRow;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authenticates the organiser's link — the same model as a company's
 * campaign link: a high-entropy token the web app moves from the URL into
 * an httpOnly cookie, then sends as a bearer header. Scope: one pot.
 *
 * The public share token never passes here: knowing the link everyone
 * else has must not let anyone cancel the gift or redirect its money.
 */
@Injectable()
export class GroupGiftOrganiserGuard implements CanActivate {
  constructor(private readonly repository: GroupGiftsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrganiserRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : '';
    if (!UUID_PATTERN.test(token)) {
      throw new UnauthorizedException('Organiser link is missing or invalid.');
    }
    const pot = await this.repository.findByOrganiserToken(token);
    if (!pot) {
      throw new UnauthorizedException('Organiser link is missing or invalid.');
    }
    request.groupGift = pot;
    return true;
  }
}

export function groupGiftOf(request: OrganiserRequest): GroupGiftRow {
  if (!request.groupGift) {
    throw new UnauthorizedException('Organiser link is missing or invalid.');
  }
  return request.groupGift;
}
