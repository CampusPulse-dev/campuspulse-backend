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
import { CreatorApplyBody } from '../../contract';
import { AuthGuard } from './auth';
import { OrganizerTeamService } from './organizer-team.service';
import { OrganizersService } from './organizers.service';

@ApiTags('creators')
@Controller('creators')
export class CreatorsController {
  constructor(
    private readonly organizers: OrganizersService,
    private readonly team: OrganizerTeamService,
  ) {}

  @Post('apply')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Apply for a campus creator profile (pending verification)' })
  @ApiBody({ schema: { $ref: '#/components/schemas/CreatorApplyBody' } })
  @ApiCreatedResponse({
    description: 'The pending creator verification request.',
    schema: { $ref: '#/components/schemas/VerificationSubmittedResponse' },
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreatorApplyBody)) body: CreatorApplyBody,
  ) {
    return this.team.applyAsCreator(user.id, body);
  }

  @Get('me/ambassador-links')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Own creator links and attributed attendance counts' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/CreatorAmbassadorLinksResponse' } })
  links(@CurrentUser() user: AuthenticatedUser) {
    return this.organizers.creatorLinks(user.id);
  }

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
