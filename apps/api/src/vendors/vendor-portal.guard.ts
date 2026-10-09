import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { VendorsRepository } from './vendors.repository';

export interface VendorContext {
  vendorId: string;
  businessName: string;
}

export interface VendorRequest extends Request {
  vendor?: VendorContext;
}

/**
 * Authenticates the vendor counter screen from its portal token.
 *
 * The token arrives as a bearer header, never a query string: the web
 * app holds it in an httpOnly cookie after the vendor opens their link
 * once, so it stops appearing in URLs — and therefore in browser
 * history, referrers and proxy logs — from the second request onward.
 *
 * An inactive vendor is refused. Deactivating a vendor in /ops is how
 * you stop sending them orders, and it should equally stop them
 * confirming collections; a vendor you have stopped working with
 * marking gifts as handed over is exactly the case this prevents.
 *
 * 401 for every failure, with one message. A token that is merely
 * unknown and one belonging to a deactivated vendor are deliberately
 * indistinguishable from outside.
 */
@Injectable()
export class VendorPortalGuard implements CanActivate {
  constructor(private readonly vendors: VendorsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<VendorRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Vendor link is missing or invalid.');
    }

    const token = header.slice('Bearer '.length).trim();
    // The column is a uuid, so anything that isn't one cannot match a
    // row — and sending it to Postgres as a uuid comparison would error
    // rather than return nothing.
    if (!UUID_PATTERN.test(token)) {
      throw new UnauthorizedException('Vendor link is missing or invalid.');
    }

    const vendor = await this.vendors.findByPortalToken(token);
    if (!vendor || !vendor.active) {
      throw new UnauthorizedException('Vendor link is missing or invalid.');
    }

    request.vendor = {
      vendorId: vendor.id,
      businessName: vendor.business_name,
    };
    return true;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
