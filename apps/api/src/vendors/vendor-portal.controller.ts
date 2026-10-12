import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { normaliseFallbackCode } from '../redemptions/fallback-code.util';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { BadRequestException } from '@nestjs/common';
import { VendorPortalGuard } from './vendor-portal.guard';
import type { VendorContext, VendorRequest } from './vendor-portal.guard';
import { VendorsRepository } from './vendors.repository';
import {
  RequestVendorItemDto,
  SetOfferingAvailabilityDto,
} from './dto/vendor.dto';
import { VendorPortalService } from './vendor-portal.service';

/**
 * The counter screen's API. One vendor, their own gifts, nothing else.
 *
 * Everything here is scoped by the vendor the token identifies — a
 * vendor cannot look up a code for a gift they do not sell, and the
 * refusal is the same 404 as an unknown code so a guessed code reveals
 * nothing about whether it exists.
 *
 * Throttled harder than the ops equivalent. A counter confirms a
 * handful of collections an hour, and this is the one authenticated
 * surface whose credential lives on a phone that gets handed around.
 */
@Controller('vendor')
@UseGuards(VendorPortalGuard)
@UseInterceptors(NoStoreInterceptor)
export class VendorPortalController {
  constructor(
    private readonly redemptions: RedemptionsService,
    private readonly vendors: VendorsRepository,
    private readonly audit: AuditService,
    private readonly portal: VendorPortalService,
  ) {}

  /** Confirms the link works and names the business, so staff can see whose till they are on. */
  @Get('me')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  me(@Req() request: VendorRequest) {
    const vendor = vendorOf(request);
    return { businessName: vendor.businessName };
  }

  @Get('redemptions/:code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  lookup(@Param('code') code: string, @Req() request: VendorRequest) {
    const vendor = vendorOf(request);
    return this.redemptions.lookupForVendor(
      requireCode(code),
      (giftTemplateId) => this.sellsGift(vendor.vendorId, giftTemplateId),
    );
  }

  @Post('redemptions/:code/complete')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async complete(
    @Param('code') code: string,
    @Body() body: { confirmedBy?: unknown },
    @Req() request: VendorRequest,
  ) {
    const vendor = vendorOf(request);
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;

    // Optional and free-text: whoever is on the till can put their name
    // to it, which is worth having in a dispute, but requiring it would
    // just produce "staff" typed a hundred times.
    const confirmedBy =
      typeof body?.confirmedBy === 'string' && body.confirmedBy.trim()
        ? `${body.confirmedBy.trim().slice(0, 80)} (${vendor.businessName})`
        : vendor.businessName;

    const { redemption, orderId } =
      await this.redemptions.completeByFallbackCode({
        code: requireCode(code),
        vendorId: vendor.vendorId,
        confirmedBy,
        actorId: null,
        actorType: 'vendor',
        ipAddress,
        userAgent,
        sellsGift: (giftTemplateId) =>
          this.sellsGift(vendor.vendorId, giftTemplateId),
      });

    await this.audit.record({
      eventType: 'REDEMPTION_COMPLETED',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'redemption',
      resourceId: redemption.id,
      newState: redemption.status,
      metadata: {
        orderId,
        vendorId: vendor.vendorId,
        confirmedVia: 'vendor_portal',
      },
      ipAddress,
      userAgent,
    });

    return {
      redemptionNumber: redemption.redemption_number,
      status: redemption.status,
    };
  }

  /** The vendor's own items: what's live, what's waiting on SendEbun, what they have today. */
  @Get('offerings')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  offerings(@Req() request: VendorRequest) {
    return this.portal.listOfferings(vendorOf(request).vendorId);
  }

  /** Sold out today / back on. New sales only; gifts already bought are still honoured. */
  @Patch('offerings/:giftTemplateId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setAvailability(
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @Body() body: SetOfferingAvailabilityDto,
    @Req() request: VendorRequest,
  ) {
    return this.portal.setAvailability(
      vendorOf(request),
      giftTemplateId,
      body.available,
      metaOf(request),
    );
  }

  /** Ask to sell something new. Created off sale; ops checks and approves it. */
  @Post('offerings')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  requestItem(
    @Body() body: RequestVendorItemDto,
    @Req() request: VendorRequest,
  ) {
    return this.portal.requestItem(vendorOf(request), body, metaOf(request));
  }

  /** Recipients who booked a time to collect here — so it's ready when they arrive. */
  @Get('pickups')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  pickups(@Req() request: VendorRequest) {
    return this.portal.listPickups(vendorOf(request).vendorId);
  }

  @Post('pickups/:orderId/confirm')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  confirmPickup(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: VendorRequest,
  ) {
    return this.portal.confirmPickup(
      vendorOf(request),
      orderId,
      metaOf(request),
    );
  }

  /**
   * An offering that is switched off still counts.
   *
   * `available` governs whether Ebun should send this vendor NEW orders
   * for a gift; it says nothing about whether a gift already paid for
   * should be honoured. A vendor who pauses an item overnight must
   * still be able to hand over the one somebody bought this morning —
   * the alternative is a recipient turned away from a counter holding a
   * gift Ebun already took money for.
   */
  private async sellsGift(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<boolean> {
    const offering = await this.vendors.findOffering(vendorId, giftTemplateId);
    return offering !== null;
  }
}

function requireCode(raw: string): string {
  const code = normaliseFallbackCode(raw);
  if (!code) {
    throw new BadRequestException(
      "That doesn't look like an Ebun code. They read EBN- followed by six characters.",
    );
  }
  return code;
}

function vendorOf(request: VendorRequest): VendorContext {
  // VendorPortalGuard always sets this before a handler runs; reaching
  // here without it means the guard was removed from this controller.
  if (!request.vendor) {
    throw new InternalServerErrorException();
  }
  return request.vendor;
}

function metaOf(request: VendorRequest) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
