import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';
import { ExpiryJob } from './expiry.job';
import { NotificationRetryJob } from './notification-retry.job';
import { ScheduledSendJob } from './scheduled-send.job';
import { StuckOrderJob } from './stuck-order.job';
import { VendorEscalationJob } from './vendor-escalation.job';
import { AlertsModule } from '../alerts/alerts.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { AutoPayoutJob } from './auto-payout.job';

/**
 * Every recurring job in one module, rather than a @Cron scattered
 * across whichever service happens to own the data. Two reasons: the
 * full schedule is readable in one place, and nothing in the request
 * path can accidentally acquire a timer by importing a service.
 *
 * Jobs depend on module services, never on repositories — same
 * boundary every other consumer respects.
 */
@Module({
  imports: [
    // The scheduler lives HERE, not in AppModule. Without it the @Cron
    // decorators below still compile, the app still boots, and not one
    // job ever fires — a silent, total failure. Owning it here means
    // importing JobsModule is enough, and no future edit to AppModule's
    // import list can quietly switch every job off.
    ScheduleModule.forRoot(),
    OrdersModule,
    NotificationsModule,
    RedemptionsModule,
    AlertsModule,
    PayoutsModule,
  ],
  providers: [
    AutoPayoutJob,
    ScheduledSendJob,
    ExpiryJob,
    StuckOrderJob,
    NotificationRetryJob,
    VendorEscalationJob,
  ],
})
export class JobsModule {}
