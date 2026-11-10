import { Module } from '@nestjs/common';
import { DevAuthGuard, DevAuthService, OptionalDevAuthGuard } from './dev-auth';
import { OrganizerAccessService } from './organizer-access.service';
import { UsersController } from './users.controller';

/**
 * Authentication, accounts, organizer team access, and user preferences.
 * Owner: Victor.
 *
 * TODO(S1-02): replace DevAuthService / DevAuthGuard with real JWT strategy
 * and add verification submission controllers.
 */
@Module({
  controllers: [UsersController],
  providers: [DevAuthService, DevAuthGuard, OptionalDevAuthGuard, OrganizerAccessService],
  exports: [DevAuthService, DevAuthGuard, OptionalDevAuthGuard, OrganizerAccessService],
})
export class IdentityModule {}
