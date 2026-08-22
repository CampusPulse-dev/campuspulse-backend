import { Module } from '@nestjs/common';
import { QrTokenService } from './qr-token.service';

/**
 * RSVP, QR check-in, and notifications.
 * Owner: Batman.
 *
 * Scaffold — QR signing is real; RSVP and check-in controllers land in S1.
 * The manual check-in path is not optional and ships beside the scanner.
 */
@Module({
  providers: [QrTokenService],
  exports: [QrTokenService],
})
export class AttendanceModule {}
