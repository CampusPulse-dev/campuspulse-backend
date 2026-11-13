import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SearchQuery } from '../../contract';
import { OptionalAuthGuard } from '../identity/auth';
import { EventsService } from './events.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Search published campus events and verified clubs' })
  @ApiOkResponse({
    description: 'Matching published events and verified organizers.',
    schema: { $ref: '#/components/schemas/AttendeeSearchResponse' },
  })
  search(
    @Query(new ZodValidationPipe(SearchQuery)) query: SearchQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.events.search(query, user?.id);
  }
}
