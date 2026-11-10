import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  CancelEventBody,
  CreateEventBody,
  FeedQuery,
  UpdateEventBody,
  UpdateFixtureBody,
} from '../../contract';
import { AuthGuard, OptionalAuthGuard } from '../identity/dev-auth';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Public event feed, filterable by category and start time' })
  @ApiOkResponse({
    description: 'A page of published events, soonest first.',
    schema: { $ref: '#/components/schemas/FeedResponse' },
  })
  feed(@Query(new ZodValidationPipe(FeedQuery)) query: FeedQuery) {
    return this.events.feed(query);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a draft event for an organizer team' })
  @ApiBody({ schema: { $ref: '#/components/schemas/CreateEventBody' } })
  @ApiCreatedResponse({
    description: 'Newly created draft event.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateEventBody)) body: CreateEventBody,
  ) {
    return this.events.create(user.id, body);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update event details or template blocks' })
  @ApiBody({ schema: { $ref: '#/components/schemas/UpdateEventBody' } })
  @ApiOkResponse({
    description: 'Updated event.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEventBody)) body: UpdateEventBody,
  ) {
    return this.events.update(user.id, id, body);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Publish a draft event (verified organizers only)' })
  @ApiOkResponse({
    description: 'Published event.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.publish(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Cancel an event with a mandatory attendee reason' })
  @ApiBody({ schema: { $ref: '#/components/schemas/CancelEventBody' } })
  @ApiOkResponse({
    description: 'Cancelled event.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CancelEventBody)) body: CancelEventBody,
  ) {
    return this.events.cancel(user.id, id, body);
  }

  @Patch(':id/fixture')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update live match score and period status' })
  @ApiBody({ schema: { $ref: '#/components/schemas/UpdateFixtureBody' } })
  @ApiOkResponse({
    description: 'Event with updated fixture scoreboard.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  updateFixture(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateFixtureBody)) body: UpdateFixtureBody,
  ) {
    return this.events.updateFixture(user.id, id, body);
  }

  @Post(':id/approve-link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Approve a cross-organizer after-party link (parent OWNER only)' })
  @ApiOkResponse({
    description: 'Linked child event after parent owner approval.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  approveLink(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.approveLink(user.id, id);
  }

  /** Public event page — must render with no session (PRD §5 flow 1); drafts hidden from non-members. */
  @Get(':slug')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Public event page by slug' })
  @ApiOkResponse({
    description: 'The event, including its organizer and template blocks.',
    schema: { $ref: '#/components/schemas/EventPublic' },
  })
  findOne(@Param('slug') slug: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.events.findBySlug(slug, user?.id);
  }
}
