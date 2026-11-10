import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SubmitReportBody } from '../../contract';
import { AuthGuard } from '../identity/dev-auth';
import { AttendanceService } from './attendance.service';

@ApiTags('moderation')
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post()
  @ApiOperation({ summary: 'Submit an attendee moderation report for an event' })
  @ApiBody({ schema: { $ref: '#/components/schemas/SubmitReportBody' } })
  @ApiCreatedResponse({
    description: 'Recorded moderation report.',
    schema: { $ref: '#/components/schemas/ReportSubmittedResponse' },
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(SubmitReportBody)) body: SubmitReportBody,
  ) {
    return this.attendance.submitReport(user.id, body);
  }
}
