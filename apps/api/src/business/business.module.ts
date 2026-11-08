import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CorporateModule } from '../corporate/corporate.module';
import { BusinessController } from './business.controller';
import { BusinessGuard } from './business.guard';
import { BusinessService } from './business.service';
import { CompaniesRepository } from './companies.repository';

/** Company accounts (sign-in, team, campaigns list). Builds on CorporateModule's campaign engine. */
@Module({
  imports: [AuthModule, AuditModule, AlertsModule, CorporateModule],
  controllers: [BusinessController],
  providers: [BusinessService, BusinessGuard, CompaniesRepository],
  exports: [CompaniesRepository],
})
export class BusinessModule {}
