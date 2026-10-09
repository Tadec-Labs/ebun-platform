import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { OpsOrdersService } from './ops-orders.service';

/**
 * Ops order visibility. Read-only — there is no POST or PATCH here and
 * that is deliberate: acting on an order means retry or refund, the
 * refund path does not exist yet, and a transition button with no
 * refund record behind it just loses money more quickly.
 *
 * ebun_finance is included alongside admin/ops, unlike the vendor and
 * catalogue controllers. Those expose bank details and set the price
 * every sender pays; this exposes what was charged and whether it was
 * delivered, which is exactly finance's job. ebun_support is NOT
 * included: these rows carry a third party's name and phone number, and
 * there is no support staff yet to justify widening that.
 *
 * No-store on every response — order rows contain recipient phone
 * numbers and should not sit in a shared cache or a back-button history
 * entry.
 */
@Controller('ops/orders')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops', 'ebun_finance')
@UseInterceptors(NoStoreInterceptor)
export class OpsOrdersController {
  constructor(private readonly orders: OpsOrdersService) {}

  @Get()
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }
}
