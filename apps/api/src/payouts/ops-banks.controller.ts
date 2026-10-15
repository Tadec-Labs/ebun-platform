import { Controller, Get, UseGuards } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { BanksService } from './banks.service';

/** The bank list for the ops vendor form. */
@Controller('ops/banks')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops', 'ebun_finance')
export class OpsBanksController {
  constructor(private readonly banks: BanksService) {}

  @Get()
  list() {
    return this.banks.list();
  }
}
