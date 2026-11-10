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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  CheckInBatchBody,
  CheckInBody,
  CreateAmbassadorLinkBody,
  CreateRsvpBody,
  RosterQuery,
} from '../../contract';
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

  @Get('events/:eventId/scanner-pack')
  @ApiOperation({
    summary:
      'Pre-sync offline scanner pack (Ed25519 public key + minimal QR digest roster for Owner/Manager/Door Staff)',
  })
  @ApiOkResponse({
    description: 'Ed25519 public key and minimal offline validation roster.',
    schema: { $ref: '#/components/schemas/ScannerPackResponse' },
  })
  getScannerPack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendance.getScannerPack(user.id, eventId);
  }

  @Get('events/:eventId/roster')
  @ApiOperation({
    summary: 'Full event RSVP roster with JSON or CSV export (Club OWNER and MANAGER only)',
  })
  @ApiOkResponse({
    description: 'Full RSVP roster (or text/csv attachment when format=csv / Accept: text/csv).',
    schema: { $ref: '#/components/schemas/RosterResponse' },
  })
  async getRoster(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query(new ZodValidationPipe(RosterQuery)) query: RosterQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const roster = await this.attendance.getRoster(user.id, eventId, query);
    const wantsCsv =
      query.format === 'csv' ||
      (typeof req.headers.accept === 'string' && req.headers.accept.includes('text/csv'));
    if (wantsCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="event-${eventId}-roster.csv"`);
      return this.attendance.formatRosterCsv(roster);
    }
    return roster;
  }

  @Post('check-in')
  @ApiOperation({
    summary: 'Record a single online QR scan or manual check-in preserving client scannedAt',
  })
  @ApiBody({ schema: { $ref: '#/components/schemas/CheckInBody' } })
  @ApiCreatedResponse({
    description: 'Recorded check-in with duplicate indicator.',
    schema: { $ref: '#/components/schemas/CheckInResponse' },
  })
  checkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CheckInBody)) body: CheckInBody,
  ) {
    return this.attendance.checkIn(user.id, body);
  }

  @Post('check-in/batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Idempotently replay up to 500 queued offline scans preserving client scannedAt',
  })
  @ApiBody({ schema: { $ref: '#/components/schemas/CheckInBatchBody' } })
  @ApiOkResponse({
    description: 'Batch replay results aligned to input order.',
    schema: { $ref: '#/components/schemas/CheckInBatchResponse' },
  })
  checkInBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CheckInBatchBody)) body: CheckInBatchBody,
  ) {
    return this.attendance.checkInBatch(user.id, body);
  }

  @Get('events/:eventId/stats')
  @ApiOperation({
    summary: 'Event headcount, north-star conversion rate, duplicates, and manual check-in stats',
  })
  @ApiOkResponse({
    description: 'Aggregated attendance metrics for Club OWNER and MANAGER.',
    schema: { $ref: '#/components/schemas/EventStatsResponse' },
  })
  getEventStats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendance.getEventStats(user.id, eventId);
  }
}
