import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeedQuery } from '@campuspulse/contract';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Public event feed, filterable by category' })
  feed(@Query(new ZodValidationPipe(FeedQuery)) query: FeedQuery) {
    return this.events.feed(query);
  }

  /** Public event page — must render with no session (PRD §5 flow 1). */
  @Get(':slug')
  @ApiOperation({ summary: 'Public event page by slug' })
  findOne(@Param('slug') slug: string) {
    return this.events.findBySlug(slug);
  }
}
