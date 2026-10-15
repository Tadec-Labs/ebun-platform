import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { CreateRefundDto } from './dto/refund.dto';
import { RefundsService } from './refunds.service';

/**
 * Refunds for one order. Same roles as the ops order screens: the people
 * who can see what a sender paid are the people who can give it back.
 * Every refund is attributed to the staff member in the audit log.
 */
@Controller('ops/orders/:orderId/refunds')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops', 'ebun_finance')
@UseInterceptors(NoStoreInterceptor)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /** Refunds so far, and whether a new one can be started. */
  @Get()
  list(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.refunds.forOrder(orderId);
  }

  /** Moves money: throttled well below any real need. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateRefundDto,
    @Req() request: StaffRequest,
  ) {
    return this.refunds.refund(
      orderId,
      {
        reasonCategory: dto.reasonCategory,
        reason: dto.reason,
        alreadyRefundedInPaystack: dto.alreadyRefundedInPaystack ?? false,
      },
      staffOf(request),
      {
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }
}

function staffOf(request: StaffRequest): StaffContext {
  // StaffGuard always sets this before a handler runs.
  if (!request.staff) throw new InternalServerErrorException();
  return request.staff;
}
