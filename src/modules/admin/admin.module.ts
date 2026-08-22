import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';

/**
 * Super Admin portal: verification queues, moderation, role
 * administration, audit log.
 *
 * NDPA constraints apply to everything here — ID documents are served
 * through short-lived non-downloadable views and deleted on decision.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AdminModule {}
