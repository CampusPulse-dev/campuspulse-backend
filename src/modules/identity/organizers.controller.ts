import {
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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { AuthGuard } from './dev-auth';
import { OrganizersService } from './organizers.service';

@ApiTags('organizers')
@Controller('organizers')
export class OrganizersController {
  constructor(private readonly organizers: OrganizersService) {}

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
}
