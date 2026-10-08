import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { StaffGuard } from './staff.guard';
import type { StaffRequest } from './staff.guard';
import { StaffRoles } from './staff-roles.decorator';

/**
 * Lets the /ops login confirm a freshly-authenticated account is
 * actually staff before the web app hands it a session. Any staff role
 * may sign in; individual routes narrow it further.
 */
@Controller('ops')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops', 'ebun_finance', 'ebun_support')
export class OpsSessionController {
  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() request: StaffRequest) {
    const staff = request.staff!;
    return { name: staff.name, email: staff.email, role: staff.role };
  }
}
