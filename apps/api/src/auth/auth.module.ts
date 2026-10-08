import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { OpsSessionController } from './ops-session.controller';
import { StaffGuard } from './staff.guard';

@Module({
  imports: [UsersModule],
  controllers: [OpsSessionController],
  providers: [AuthService, StaffGuard],
  // UsersModule re-exported so a module that uses @UseGuards(StaffGuard)
  // can resolve the guard's UsersService dependency by importing only
  // AuthModule.
  exports: [AuthService, StaffGuard, UsersModule],
})
export class AuthModule {}
