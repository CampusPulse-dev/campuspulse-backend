import { Injectable, Logger } from '@nestjs/common';

export interface TransactionalEmailInput {
  userId: string;
  to: string;
  subject: string;
  text: string;
  eventId?: string;
  template: 'event-cancelled' | 'event-updated' | 'student-otp';
}

export interface SentEmailRecord extends TransactionalEmailInput {
  sentAt: string;
}

const MAX_IN_MEMORY_MESSAGES = 500;

/**
 * Console/structured-logger email adapter for local dev & CI.
 * NDPA 2023: never logs raw student email addresses to Pino/stdout — logs only
 * `userId`, `eventId`, and `template`.
 *
 * TODO(S3-03): add Resend/SMTP production transport behind EmailAdapter.
 */
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);
  private readonly sentMessages: SentEmailRecord[] = [];

  async send(input: TransactionalEmailInput): Promise<void> {
    await Promise.resolve();
    const record: SentEmailRecord = {
      ...input,
      sentAt: new Date().toISOString(),
    };
    this.sentMessages.push(record);
    if (this.sentMessages.length > MAX_IN_MEMORY_MESSAGES) {
      this.sentMessages.shift();
    }

    this.logger.log({
      msg: 'Transactional email dispatched (dev console adapter)',
      userId: input.userId,
      eventId: input.eventId ?? null,
      template: input.template,
      subject: input.subject,
    });
  }

  getSentMessages(): SentEmailRecord[] {
    return [...this.sentMessages];
  }

  clearSentMessages(): void {
    this.sentMessages.length = 0;
  }
}
