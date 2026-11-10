import { Module } from '@nestjs/common';
import { CreatorsController } from './creators.controller';
import { DevAuthGuard, DevAuthService, OptionalDevAuthGuard } from './dev-auth';
import { FriendsGoingService } from './friends-going.service';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { OrganizerAccessService } from './organizer-access.service';
import { OrganizersController } from './organizers.controller';
import { OrganizersService } from './organizers.service';
import { UsersController } from './users.controller';

/**
 * Authentication, accounts, mutual friends graph, organizer team access,
 * public club/creator profiles, and user preferences.
 * Owner: Victor.
 *
 * TODO(S1-02): replace DevAuthService / DevAuthGuard with real JWT strategy
 * and add verification submission controllers.
 */
@Module({
  controllers: [UsersController, OrganizersController, CreatorsController, FriendsController],
  providers: [
    DevAuthService,
    DevAuthGuard,
    OptionalDevAuthGuard,
    OrganizerAccessService,
    OrganizersService,
    FriendsService,
    FriendsGoingService,
  ],
  exports: [
    DevAuthService,
    DevAuthGuard,
    OptionalDevAuthGuard,
    OrganizerAccessService,
    OrganizersService,
    FriendsService,
    FriendsGoingService,
  ],
})
export class IdentityModule {}
