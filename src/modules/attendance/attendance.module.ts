import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { QrTokenService } from './qr-token.service';
import { ReportsController } from './reports.controller';

/**
 * RSVP, Ed25519 QR signing, waitlist promotion, ambassador attribution, and check-in.
 * Owner: Batman.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AttendanceController, ReportsController],
  providers: [QrTokenService, AttendanceService],
  exports: [QrTokenService, AttendanceService],
})
export class AttendanceModule {}
