import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { OpsCompleteRedemptionDto } from './dto/ops-redeem.dto';
import { normaliseFallbackCode } from './fallback-code.util';
import { RedemptionsService } from './redemptions.service';

/**
 * Staff-side collection. The public POST /redeem is the vendor-scanner
 * surface: it takes a redemption_token nobody can read off a screen and
 * type, which is correct for a scanner and useless for a person. Until
 * that scanner exists, every real collection is an Ebun staff member
 * reading back the six-character code the recipient shows them — so it
 * gets an endpoint that takes that code, behind the staff session that
 * already exists, rather than widening the public one.
 *
 * Restricted to ebun_admin / ebun_ops. Completing a redemption is the
 * irreversible, money-adjacent half of the whole product (it is what
 * makes a vendor payable and a gift spent), so it sits with the same
 * two roles that can edit vendors, not with support.
 *
 * Throttled well below the global default: a staff member confirming
 * collections types a handful of codes a minute, and the lookup route
 * is the one place a valid session could otherwise be used to walk the
 * code space.
 */
@Controller('ops/redemptions')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops')
@UseInterceptors(NoStoreInterceptor)
export class OpsRedemptionsController {
  constructor(
    private readonly redemptions: RedemptionsService,
    private readonly audit: AuditService,
  ) {}

  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  lookup(@Param('code') code: string) {
    return this.redemptions.lookupByFallbackCode(requireCode(code));
  }

  @Post(':code/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async complete(
    @Param('code') code: string,
    @Body() dto: OpsCompleteRedemptionDto,
    @Req() request: StaffRequest,
  ) {
    const staff = staffOf(request);
    const normalised = requireCode(code);
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;

    const { redemption, orderId } =
      await this.redemptions.completeByFallbackCode({
        code: normalised,
        vendorId: dto.vendorId,
        // Recorded on the redemption row itself as who confirmed the
        // handover. Named as ops, not as the vendor, so the audit trail
        // never implies a vendor scanned something they didn't.
        confirmedBy: `${staff.name ?? staff.email} (Ebun ops)`,
        actorId: staff.userId,
        ipAddress,
        userAgent,
      });

    // attempt_redemption() writes its own row for the redemption state
    // change, and the order's transition writes one too. This third one
    // records the part neither of those can know: WHICH staff member
    // confirmed it, from where. Written after the fact, like every
    // other audit call here — see AuditService on why a failed audit
    // write never fails the request.
    await this.audit.record({
      eventType: 'REDEMPTION_COMPLETED',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'redemption',
      resourceId: redemption.id,
      newState: redemption.status,
      metadata: {
        orderId,
        vendorId: dto.vendorId,
        confirmedVia: 'ops_manual_code_entry',
        staffRole: staff.role,
      },
      ipAddress,
      userAgent,
    });

    return {
      redemptionNumber: redemption.redemption_number,
      status: redemption.status,
    };
  }
}

/**
 * Shape-checked here rather than in a DTO because the code is a path
 * param: rejecting a malformed one before the service runs keeps this
 * route from doubling as a way to probe the redemptions table with
 * arbitrary strings.
 */
function requireCode(raw: string): string {
  const code = normaliseFallbackCode(raw);
  if (!code) {
    throw new BadRequestException(
      "That doesn't look like an Ebun code. They read EBN- followed by six characters.",
    );
  }
  return code;
}

function staffOf(request: StaffRequest): StaffContext {
  // StaffGuard always sets this before a handler runs; reaching here
  // without it means the guard was removed from this controller.
  if (!request.staff) {
    throw new InternalServerErrorException();
  }
  return request.staff;
}
