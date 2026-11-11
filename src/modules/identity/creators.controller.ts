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
import { AuthGuard } from './auth';
import { OrganizersService } from './organizers.service';

@ApiTags('creators')
@Controller('creators')
export class CreatorsController {
  constructor(private readonly organizers: OrganizersService) {}

  @Get(':handle')
  @ApiOperation({ summary: 'Public campus creator profile and featured events' })
  @ApiOkResponse({
    description: 'Creator profile.',
    schema: { $ref: '#/components/schemas/CreatorPublic' },
  })
  getByHandle(@Param('handle') handle: string) {
    return this.organizers.getCreatorByHandle(handle);
  }

  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Follow a campus creator (idempotent)' })
  @ApiOkResponse({
    description: 'Updated follow state and follower count.',
    schema: { $ref: '#/components/schemas/FollowCreatorResponse' },
  })
  follow(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizers.followCreator(user.id, id);
  }

  @Delete(':id/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Unfollow a campus creator (idempotent)' })
  @ApiOkResponse({
    description: 'Updated follow state and follower count.',
    schema: { $ref: '#/components/schemas/FollowCreatorResponse' },
  })
  unfollow(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizers.unfollowCreator(user.id, id);
  }
}
