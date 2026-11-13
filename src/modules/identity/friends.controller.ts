import {
  Body,
  Controller,
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
import { FriendActionBody, FriendRequestBody } from '../../contract';
import { AuthGuard } from './auth';
import { FriendsService } from './friends.service';

@ApiTags('friends')
@Controller('friends')
@UseGuards(AuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  @ApiOperation({
    summary: 'List accepted friends, pending requests, and hall/faculty cohort suggestions',
  })
  @ApiOkResponse({
    description: 'Friend entries and campus suggestions.',
    schema: { $ref: '#/components/schemas/FriendsResponse' },
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.friends.list(user.id);
  }

  @Post('request')
  @ApiOperation({ summary: 'Send a mutual friend request' })
  @ApiBody({ schema: { $ref: '#/components/schemas/FriendRequestBody' } })
  @ApiCreatedResponse({
    description: 'Updated or created friend entry.',
    schema: { $ref: '#/components/schemas/FriendEntry' },
  })
  requestFriendship(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(FriendRequestBody)) body: FriendRequestBody,
  ) {
    return this.friends.requestFriendship(user.id, body);
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept, decline, or block a friend request or suggested peer' })
  @ApiBody({ schema: { $ref: '#/components/schemas/FriendActionBody' } })
  @ApiOkResponse({
    description: 'Updated friend entry.',
    schema: { $ref: '#/components/schemas/FriendEntry' },
  })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(FriendActionBody)) body: FriendActionBody,
  ) {
    return this.friends.respond(user.id, id, body);
  }
}
