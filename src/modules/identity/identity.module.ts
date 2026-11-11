import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import {
  AuthService,
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  OrganizerAccessGuard,
  PasswordService,
} from './auth';
import { AuthController } from './auth/auth.controller';
import { CreatorsController } from './creators.controller';
import { DevAuthService } from './dev-auth';
import { FriendsGoingService } from './friends-going.service';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { OrganizerAccessService } from './organizer-access.service';
import { OrganizerTeamService } from './organizer-team.service';
import { OrganizersController } from './organizers.controller';
import { OrganizersService } from './organizers.service';
import { UsersController } from './users.controller';

/**
 * Authentication, accounts, mutual friends graph, organizer team access,
 * public club/creator profiles, and user preferences.
 * Owner: Victor.
 *
 * Sessions are a short-lived access JWT plus a rotating httpOnly refresh
 * cookie (`./auth`). `./dev-auth` is the X-Dev-User fallback for local
 * development and e2e suites only.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
    OrganizersController,
    CreatorsController,
    FriendsController,
  ],
  providers: [
    AuthService,
    PasswordService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    OrganizerAccessGuard,
    DevAuthService,
    OrganizerAccessService,
    OrganizerTeamService,
    OrganizersService,
    FriendsService,
    FriendsGoingService,
  ],
  exports: [
    OrganizerTeamService,
    AuthService,
    PasswordService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    OrganizerAccessGuard,
    DevAuthService,
    OrganizerAccessService,
    OrganizersService,
    FriendsService,
    FriendsGoingService,
  ],
})
export class IdentityModule {}
