import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RedemptionsService } from './redemptions.service';
import { RedeemDto } from './dto/redeem.dto';

/**
 * POST /redeem — NOT POST /redeem/:token. The originally-sketched URL
 * shape (`/redeem/[token]`) put the redemption_token in a URL path,
 * which the schema explicitly forbids: "redemption_token is never in a
 * URL. It is the QR code payload." (redemptions table comment). A URL
 * path segment ends up in browser history, server access logs, and
 * proxy/CDN logs — all places a HIGH-ENTROPY, VALUE-BEARING token
 * (unlike reveal_token, possessing this one lets you actually claim the
 * gift) should never sit. The token travels in a POST body instead,
 * exactly like Ebun's other sensitive tokens (Paystack's webhook
 * signature, for instance, is a header, never a query param).
 *
 * In practice this endpoint is called by whatever reads the QR code a
 * vendor scans (a vendor-facing app/portal — not built yet, tracked
 * separately) for digital_voucher gifts, and internally by
 * RevealService for vtu gifts that have no vendor step to wait for (see
 * RevealService.acceptGift).
 */
@Controller('redeem')
export class RedemptionsController {
  constructor(private readonly redemptions: RedemptionsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async redeem(
    @Body() dto: RedeemDto,
    @Req() request: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    const redemption = await this.redemptions.complete({
      redemptionToken: dto.redemptionToken,
      vendorId: dto.vendorId,
      vendorConfirmedBy: dto.vendorConfirmedBy,
      ipAddress: request.ip ?? null,
      userAgent: userAgent ?? null,
      actorType: 'vendor',
    });

    return {
      redemptionNumber: redemption.redemption_number,
      status: redemption.status,
    };
  }
}
