import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PaystackModule } from '../paystack/paystack.module';
import { AutoPayoutsRepository } from './auto-payouts.repository';
import { AutoPayoutsService } from './auto-payouts.service';
import { BanksService } from './banks.service';
import { OpsBanksController } from './ops-banks.controller';

/**
 * Paying partners automatically, and the bank list that makes it
 * possible. Depends only on Paystack, audit and the database, so
 * redemptions, deliveries, payments and jobs can all import it without a
 * cycle.
 */
@Module({
  imports: [PaystackModule, AuditModule, AuthModule],
  controllers: [OpsBanksController],
  providers: [AutoPayoutsRepository, AutoPayoutsService, BanksService],
  exports: [AutoPayoutsService, BanksService, AutoPayoutsRepository],
})
export class PayoutsModule {}
