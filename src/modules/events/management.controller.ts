import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ManagedEventsQuery } from '../../contract';
import { AuthGuard } from '../identity/auth';
import { ManagementService } from './management.service';

@ApiTags('organizer-management')
@Controller()
@UseGuards(AuthGuard)
export class ManagementController {
  constructor(private readonly management: ManagementService) {}
  @Get('organizers/:id/dashboard')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Private club dashboard for OWNER and MANAGER' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/OrganizerDashboardResponse' } })
  dashboard(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.management.dashboard(user.id, id);
  }
  @Get('organizers/:id/managed-events')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Private events across all statuses for OWNER and MANAGER' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/ManagedEventsResponse' } })
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ManagedEventsQuery)) query: ManagedEventsQuery,
  ) {
    return this.management.listEvents(user.id, id, query);
  }
  @Get('events/:id/manage')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Editable private event details for OWNER and MANAGER' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/ManagedEvent' } })
  event(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.management.event(user.id, id);
  }
}
