import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_PHOTO_BYTES } from '../storage/public-photos.service';
import type { UploadedPhoto } from '../storage/public-photos.service';
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
  RequestPriceChangeDto,
  RequestVendorItemDto,
  SetOfferingAvailabilityDto,
  UpdateVendorProfileDto,
} from './dto/vendor.dto';
import { VendorPortalService } from './vendor-portal.service';
import { EarningsService } from './earnings.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import {
  DispatchDeliveryDto,
  HandoverCodeDto,
} from '../deliveries/dto/delivery.dto';

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
/** One photo, size-capped by multer before any of it reaches a handler. */
const PHOTO_UPLOAD = FileInterceptor('photo', {
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

@Controller('vendor')
@UseGuards(VendorPortalGuard)
@UseInterceptors(NoStoreInterceptor)
export class VendorPortalController {
  constructor(
    private readonly redemptions: RedemptionsService,
    private readonly vendors: VendorsRepository,
    private readonly audit: AuditService,
    private readonly portal: VendorPortalService,
    private readonly earnings: EarningsService,
    private readonly deliveries: DeliveriesService,
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

  /**
   * Ask to sell something new. Created off sale; ops checks and approves
   * it. JSON, or multipart with an optional `photo` file.
   */
  @Post('offerings')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @UseInterceptors(PHOTO_UPLOAD)
  requestItem(
    @Body() body: RequestVendorItemDto,
    @UploadedFile() photo: UploadedPhoto | undefined,
    @Req() request: VendorRequest,
  ) {
    return this.portal.requestItem(
      vendorOf(request),
      body,
      metaOf(request),
      photo,
    );
  }

  /**
   * A new shop price. For a live item this is a request — the current
   * price keeps selling until SendEbun approves. Sending the current
   * price withdraws one.
   */
  @Patch('offerings/:giftTemplateId/price')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  requestPriceChange(
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @Body() body: RequestPriceChangeDto,
    @Req() request: VendorRequest,
  ) {
    return this.portal.requestPriceChange(
      vendorOf(request),
      giftTemplateId,
      body.inStorePrice,
      metaOf(request),
    );
  }

  /** Stop selling an item. Refused while a paid gift still needs this shop. */
  @Delete('offerings/:giftTemplateId')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  removeItem(
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @Req() request: VendorRequest,
  ) {
    return this.portal.removeItem(
      vendorOf(request),
      giftTemplateId,
      metaOf(request),
    );
  }

  /** A photo for an item still waiting for approval, or one that has none. */
  @Post('offerings/:giftTemplateId/photo')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @UseInterceptors(PHOTO_UPLOAD)
  addPhoto(
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @UploadedFile() photo: UploadedPhoto | undefined,
    @Req() request: VendorRequest,
  ) {
    if (!photo) {
      throw new BadRequestException('Choose a photo to upload.');
    }
    return this.portal.addPhoto(
      vendorOf(request),
      giftTemplateId,
      photo,
      metaOf(request),
    );
  }

  /** The vendor's own details. Bank details come back masked. */
  @Get('profile')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  profile(@Req() request: VendorRequest) {
    return this.portal.getProfile(vendorOf(request).vendorId);
  }

  @Patch('profile')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateProfile(
    @Body() body: UpdateVendorProfileDto,
    @Req() request: VendorRequest,
  ) {
    return this.portal.updateProfile(vendorOf(request), body, metaOf(request));
  }

  /** What the vendor has collected, what SendEbun owes them, and what's been paid. */
  @Get('earnings')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getEarnings(@Req() request: VendorRequest) {
    return this.earnings.forVendor(vendorOf(request).vendorId);
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
   * Doorstep gifts this shop is delivering: name, phone, address and
   * landmark — what a rider needs. Only deliveries assigned to this
   * vendor, and only once the recipient has given an address.
   */
  @Get('deliveries')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listDeliveries(@Req() request: VendorRequest) {
    return this.deliveries.listForVendor(vendorOf(request).vendorId);
  }

  /** "Got it" — the vendor has seen it and is preparing it. */
  @Post('deliveries/:orderId/ack')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async acknowledgeDelivery(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: VendorRequest,
  ) {
    await this.deliveries.acknowledge(vendorOf(request).vendorId, orderId);
    return { ok: true };
  }

  @Post('deliveries/:orderId/dispatch')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async dispatchDelivery(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: DispatchDeliveryDto,
    @Req() request: VendorRequest,
  ) {
    await this.deliveries.dispatch(
      { kind: 'vendor', vendorId: vendorOf(request).vendorId },
      orderId,
      { name: dto.riderName, phone: dto.riderPhone },
    );
    return { ok: true };
  }

  /**
   * Handed over at the door, proven by the recipient's 4-digit code.
   * Credits the vendor (item + delivery fee) on their Earnings screen.
   * Five tries per delivery, counted in the database; this throttle only
   * stops a script hammering across many deliveries.
   */
  @Post('deliveries/:orderId/delivered')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async deliveredDelivery(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: HandoverCodeDto,
    @Req() request: VendorRequest,
  ) {
    await this.deliveries.markDelivered(
      { kind: 'vendor', vendorId: vendorOf(request).vendorId },
      orderId,
      dto.code,
    );
    return { ok: true };
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
