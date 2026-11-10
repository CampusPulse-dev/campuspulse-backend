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
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CreateStoryBody } from '../../contract';
import { AuthGuard, OptionalAuthGuard } from '../identity/dev-auth';
import { StoriesService } from './stories.service';

@ApiTags('stories')
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Active 24-hour stories grouped by organizer (followed first)' })
  @ApiOkResponse({
    description: 'Active non-expired stories.',
    schema: { $ref: '#/components/schemas/StoriesResponse' },
  })
  list(@CurrentUser() user?: AuthenticatedUser) {
    return this.stories.listActive(user?.id);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Post a 24-hour story for a verified organizer' })
  @ApiBody({ schema: { $ref: '#/components/schemas/CreateStoryBody' } })
  @ApiCreatedResponse({
    description: 'Created story with server-assigned 24-hour expiry.',
    schema: { $ref: '#/components/schemas/Story' },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateStoryBody)) body: CreateStoryBody,
  ) {
    return this.stories.create(user.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a story (organizer team or moderator)' })
  @ApiNoContentResponse({ description: 'Story deleted.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.stories.remove(user, id);
  }
}
