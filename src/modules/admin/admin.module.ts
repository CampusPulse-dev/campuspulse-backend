import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StorageModule } from '../../common/storage/storage.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminModerationService } from './admin-moderation.service';
import { AdminPlatformService } from './admin-platform.service';
import { AdminVerificationsService } from './admin-verifications.service';
import { AdminController } from './admin.controller';

/**
 * Super Admin portal: verification queues, moderation, role
 * administration, audit log.
 *
 * NDPA constraints apply to everything here — ID documents are served
 * through short-lived non-downloadable views and deleted on decision.
 */
@Module({
  imports: [IdentityModule, StorageModule],
  controllers: [AdminController],
  providers: [
    AuditService,
    RolesGuard,
    AdminVerificationsService,
    AdminModerationService,
    AdminPlatformService,
  ],
  exports: [AuditService],
})
export class AdminModule {}
