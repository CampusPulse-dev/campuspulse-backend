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
import { CreateAmbassadorLinkBody, CreateRsvpBody } from '../../contract';
import { AuthGuard } from '../identity/dev-auth';
import { AttendanceService } from './attendance.service';

@ApiTags('attendance')
@Controller('attendance')
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('rsvps')
  @ApiOperation({
    summary: 'Reserve an event pass or waitlist spot with atomic capacity locking and Ed25519 QR',
  })
  @ApiBody({ schema: { $ref: '#/components/schemas/CreateRsvpBody' } })
  @ApiCreatedResponse({
    description: 'Confirmed or waitlisted RSVP with signed QR token.',
    schema: { $ref: '#/components/schemas/CreateRsvpResponse' },
  })
  createRsvp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateRsvpBody)) body: CreateRsvpBody,
  ) {
    return this.attendance.createRsvp(user.id, body);
  }

  @Delete('rsvps/:eventId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel caller RSVP and atomically promote the oldest waitlisted attendee',
  })
  @ApiOkResponse({
    description: 'Cancellation result and promoted waitlist RSVP id if any.',
    schema: { $ref: '#/components/schemas/CancelRsvpResponse' },
  })
  cancelRsvp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendance.cancelRsvp(user.id, eventId);
  }

  @Get('me/tickets')
  @ApiOperation({
    summary: 'List signed-in attendee tickets and Your Night parent/after-party groups',
  })
  @ApiOkResponse({
    description: 'Attendee tickets and Your Night itinerary groups.',
    schema: { $ref: '#/components/schemas/AttendeeTicketsResponse' },
  })
  listMyTickets(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.listMyTickets(user.id);
  }

  @Post('interested/:eventId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bookmark an event as Interested for reminder updates' })
  @ApiOkResponse({
    description: 'Updated Interested state.',
    schema: { $ref: '#/components/schemas/InterestedResponse' },
  })
  addInterest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendance.addInterest(user.id, eventId);
  }

  @Delete('interested/:eventId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an event from Interested bookmarks' })
  @ApiOkResponse({
    description: 'Updated Interested state.',
    schema: { $ref: '#/components/schemas/InterestedResponse' },
  })
  removeInterest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendance.removeInterest(user.id, eventId);
  }

  @Post('ambassador-links')
  @ApiOperation({ summary: 'Generate a trackable ambassador referral link (verified Creators)' })
  @ApiBody({ schema: { $ref: '#/components/schemas/CreateAmbassadorLinkBody' } })
  @ApiCreatedResponse({
    description: 'Generated or existing ambassador referral link.',
    schema: { $ref: '#/components/schemas/AmbassadorLinkResponse' },
  })
  createAmbassadorLink(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateAmbassadorLinkBody)) body: CreateAmbassadorLinkBody,
  ) {
    return this.attendance.createAmbassadorLink(user.id, body);
  }
}
