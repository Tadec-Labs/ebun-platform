import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { EventRow } from './events.repository';
import { EventsRepository } from './events.repository';

export interface HostRequest extends Request {
  event?: EventRow;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authenticates the host's private link, the same model as a pot
 * organiser's: a high-entropy token the web app moves from the URL into
 * an httpOnly cookie, then sends as a bearer header. Scope: one event.
 * The public slug never passes here.
 */
@Injectable()
export class EventHostGuard implements CanActivate {
  constructor(private readonly repository: EventsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HostRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : '';
    if (!UUID_PATTERN.test(token)) {
      throw new UnauthorizedException('Host link is missing or invalid.');
    }
    const event = await this.repository.findByHostToken(token);
    if (!event) {
      throw new UnauthorizedException('Host link is missing or invalid.');
    }
    request.event = event;
    return true;
  }
}

export function eventOf(request: HostRequest): EventRow {
  if (!request.event) {
    throw new UnauthorizedException('Host link is missing or invalid.');
  }
  return request.event;
}
