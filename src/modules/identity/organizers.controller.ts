import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AddTeamMemberBody, SubmitOrganizerVerificationBody } from '../../contract';
import { AuthGuard, OrganizerAccess, OrganizerAccessGuard } from './auth';
import { OrganizerTeamService } from './organizer-team.service';
import { OrganizersService } from './organizers.service';

@ApiTags('organizers')
@Controller('organizers')
export class OrganizersController {
  constructor(
    private readonly organizers: OrganizersService,
    private readonly team: OrganizerTeamService,
  ) {}

  // Declared before `:slug` so "mine" is never read as a club slug.
  @Get('mine')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Clubs the signed-in user owns or manages' })
  @ApiOkResponse({
    description: 'Memberships with role and club verification state.',
    schema: { $ref: '#/components/schemas/MyOrganizersResponse' },
  })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.team.listMine(user.id);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Apply to register a club (creates a pending verification)' })
  @ApiBody({ schema: { $ref: '#/components/schemas/SubmitOrganizerVerificationBody' } })
  @ApiCreatedResponse({
    description: 'The new, not-yet-verified club with the caller as OWNER.',
    schema: { $ref: '#/components/schemas/OrganizerMembership' },
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(SubmitOrganizerVerificationBody))
    body: SubmitOrganizerVerificationBody,
  ) {
    return this.team.apply(user.id, body);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public organizer club profile by slug' })
  @ApiOkResponse({
    description: 'Organizer profile.',
    schema: { $ref: '#/components/schemas/OrganizerPublic' },
  })
  getBySlug(@Param('slug') slug: string) {
    return this.organizers.getBySlug(slug);
  }

  @Get(':slug/events')
  @ApiOperation({ summary: 'Published events hosted by this organizer' })
  @ApiOkResponse({
    description: 'Published events for the organizer.',
    schema: { $ref: '#/components/schemas/FeedResponse' },
  })
  getEventsBySlug(@Param('slug') slug: string) {
    return this.organizers.getEventsBySlug(slug);
  }

  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Follow an organizer club (idempotent)' })
  @ApiOkResponse({
    description: 'Updated follow state and follower count.',
    schema: { $ref: '#/components/schemas/FollowOrganizerResponse' },
  })
  follow(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizers.followOrganizer(user.id, id);
  }

  @Delete(':id/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Unfollow an organizer club (idempotent)' })
  @ApiOkResponse({
    description: 'Updated follow state and follower count.',
    schema: { $ref: '#/components/schemas/FollowOrganizerResponse' },
  })
  unfollow(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizers.unfollowOrganizer(user.id, id);
  }

  @Get(':id/team')
  @UseGuards(AuthGuard, OrganizerAccessGuard)
  @OrganizerAccess({ scope: 'organizer', param: 'id', roles: ['OWNER', 'MANAGER'] })
  @ApiOperation({ summary: 'Club team with masked email hints (team members only)' })
  @ApiOkResponse({
    description: 'Team members and the caller role.',
    schema: { $ref: '#/components/schemas/TeamResponse' },
  })
  getTeam(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.getTeam(user.id, id);
  }

  @Post(':id/team')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, OrganizerAccessGuard)
  @OrganizerAccess({ scope: 'organizer', param: 'id', roles: ['OWNER'] })
  @ApiOperation({ summary: 'Add a registered user as MANAGER (Club OWNER only)' })
  @ApiBody({ schema: { $ref: '#/components/schemas/AddTeamMemberBody' } })
  @ApiOkResponse({
    description: 'Updated team.',
    schema: { $ref: '#/components/schemas/TeamResponse' },
  })
  addManager(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AddTeamMemberBody)) body: AddTeamMemberBody,
  ) {
    return this.team.addManager(user.id, id, body.email);
  }

  @Delete(':id/team/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, OrganizerAccessGuard)
  @OrganizerAccess({ scope: 'organizer', param: 'id', roles: ['OWNER'] })
  @ApiOperation({ summary: 'Remove a manager from the team (Club OWNER only)' })
  @ApiOkResponse({
    description: 'Updated team.',
    schema: { $ref: '#/components/schemas/TeamResponse' },
  })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.team.removeMember(user.id, id, userId);
  }
}
