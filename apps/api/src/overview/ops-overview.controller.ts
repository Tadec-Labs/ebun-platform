import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { OverviewService } from './overview.service';

/**
 * /ops's home: what happened today and what needs a person. Read-only.
 * Finance included — payouts and takings are their job.
 */
@Controller('ops')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops', 'ebun_finance')
@UseInterceptors(NoStoreInterceptor)
export class OpsOverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('overview')
  get() {
    return this.overview.overview();
  }

  @Get('payouts')
  payouts() {
    return this.overview.payouts();
  }
}
