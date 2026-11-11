import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Env } from '../../config/env';

export interface TransactionalEmailInput {
  userId: string;
  to: string;
  subject: string;
  text: string;
  eventId?: string;
  template: 'event-cancelled' | 'event-updated' | 'student-otp';
  idempotencyKey?: string;
}

export interface SentEmailRecord extends TransactionalEmailInput {
  sentAt: string;
}

const MAX_IN_MEMORY_MESSAGES = 500;

/**
 * Memory transport for development/test; HTTPS Resend transport for production.
 * NDPA 2023: never logs raw student email addresses to Pino/stdout — logs only
 * `userId`, `eventId`, and `template`.
 *
 */
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);
  private readonly sentMessages: SentEmailRecord[] = [];
  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(input: TransactionalEmailInput): Promise<void> {
    if (this.config.get('EMAIL_TRANSPORT', { infer: true }) === 'resend') {
      await this.sendResend(input);
      return;
    }
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
    });
  }

  private async sendResend(input: TransactionalEmailInput): Promise<void> {
    const key =
      input.idempotencyKey ??
      createHash('sha256')
        .update(JSON.stringify([input.userId, input.template, input.to, input.subject, input.text]))
        .digest('hex');
    const body = JSON.stringify({
      from: this.config.get('EMAIL_FROM', { infer: true }),
      to: [input.to],
      subject: input.subject,
      text: input.text,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.get('RESEND_API_KEY', { infer: true })}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        if (attempt === 2) throw new Error('Transactional email transport unavailable');
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      if (response.ok) return;
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt === 2)
        throw new Error(`Transactional email rejected (${response.status})`);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }

  getSentMessages(): SentEmailRecord[] {
    return [...this.sentMessages];
  }

  clearSentMessages(): void {
    this.sentMessages.length = 0;
  }
}
