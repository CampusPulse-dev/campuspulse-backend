import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export interface QrPayload {
  rsvpId: string;
  eventId: string;
  issuedAt: number;
}

/**
 * QR tokens are HMAC-signed so the scanner can verify one entirely
 * on-device in <500ms, with no network round trip (PRD §6). Format is
 * `base64url(payload).base64url(signature)`.
 */
@Injectable()
export class QrTokenService {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('QR_SIGNING_SECRET', { infer: true });
  }

  sign(payload: QrPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.signature(body)}`;
  }

  /** Returns the payload, or null when the signature does not verify. */
  verify(token: string): QrPayload | null {
    const [body, provided] = token.split('.');
    if (!body || !provided) return null;

    const expected = this.signature(body);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on a length mismatch.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString()) as QrPayload;
    } catch {
      return null;
    }
  }

  private signature(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
