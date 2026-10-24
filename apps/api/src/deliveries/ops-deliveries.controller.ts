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
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { DeliveriesService } from './deliveries.service';
import {
  AssignDeliveryVendorDto,
  DeliveryFailedDto,
  DispatchDeliveryDto,
} from './dto/delivery.dto';

/**
 * Ops' hands on doorstep deliveries: see what is waiting on whom, give a
 * delivery to a different vendor, and mark it sent or delivered when the
 * vendor confirmed by phone instead of on their link.
 *
 * admin/ops only — these move orders and credit vendors. Finance reads
 * orders through /ops/orders.
 */
@Controller('ops/deliveries')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops')
@UseInterceptors(NoStoreInterceptor)
export class OpsDeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  list() {
    return this.deliveries.listForOps();
  }

  @Post(':orderId/vendor')
  async assign(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AssignDeliveryVendorDto,
    @Req() request: StaffRequest,
  ) {
    await this.deliveries.assignVendor(
      staffOf(request).userId,
      orderId,
      dto.vendorId,
    );
    return { ok: true };
  }

  @Post(':orderId/dispatch')
  async dispatch(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: DispatchDeliveryDto,
    @Req() request: StaffRequest,
  ) {
    await this.deliveries.dispatch(
      { kind: 'staff', userId: staffOf(request).userId },
      orderId,
      { name: dto.riderName, phone: dto.riderPhone },
    );
    return { ok: true };
  }

  @Post(':orderId/failed')
  async failed(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: DeliveryFailedDto,
    @Req() request: StaffRequest,
  ) {
    await this.deliveries.markFailed(
      { kind: 'staff', userId: staffOf(request).userId },
      orderId,
      dto.reason,
    );
    return { ok: true };
  }

  @Post(':orderId/delivered')
  async delivered(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: StaffRequest,
  ) {
    await this.deliveries.markDelivered(
      { kind: 'staff', userId: staffOf(request).userId },
      orderId,
    );
    return { ok: true };
  }
}

function staffOf(request: StaffRequest): StaffContext {
  if (!request.staff) throw new InternalServerErrorException();
  return request.staff;
}
