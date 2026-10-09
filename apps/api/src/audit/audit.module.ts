import { Module } from '@nestjs/common';
import { AuditEventsRepository } from './audit-events.repository';
import { AuditService } from './audit.service';

@Module({
  providers: [AuditService, AuditEventsRepository],
  exports: [AuditService, AuditEventsRepository],
})
export class AuditModule {}
