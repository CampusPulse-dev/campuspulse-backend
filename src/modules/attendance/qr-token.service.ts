import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

/** RFC 8410 ASN.1 PKCS#8 v1 prefix for a 32-byte Ed25519 private seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface SignQrInput {
  rsvpId: string;
  eventId: string;
  showtimeId?: string;
  issuedAt: number;
}

export interface QrPayload extends SignQrInput {
  v: 1;
}

/**
 * QR tokens are asymmetrically signed with **Ed25519** (`node:crypto`) so
 * offline browser door scanners verify tickets in `<5ms` using the derived
 * 32-byte public key without ever exposing server signing keys.
 *
 * Token format: `b64url(JSON{v:1,rsvpId,eventId,showtimeId?,issuedAt}).b64url(sig)`
 */
@Injectable()
export class QrTokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly publicKeyBase64Url: string;

  constructor(config: ConfigService<Env, true>) {
    const pkcs8Base64 = config.get('QR_SIGNING_PRIVATE_KEY', { infer: true });
    const legacySecret = config.get('QR_SIGNING_SECRET', { infer: true });

    if (pkcs8Base64) {
      this.privateKey = createPrivateKey({
        key: Buffer.from(pkcs8Base64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
    } else if (legacySecret) {
      const seed = createHash('sha256').update(legacySecret).digest();
      this.privateKey = createPrivateKey({
        key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
        format: 'der',
        type: 'pkcs8',
      });
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
    }

    this.publicKey = createPublicKey(this.privateKey);
    const jwk = this.publicKey.export({ format: 'jwk' });
    if (!jwk.x) {
      throw new Error('Failed to derive raw Ed25519 public key');
    }
    this.publicKeyBase64Url = jwk.x;
  }

  /** Raw 32-byte base64url Ed25519 public key for Web Crypto / @noble/ed25519 scanners. */
  getPublicKey(): string {
    return this.publicKeyBase64Url;
  }

  sign(input: SignQrInput): string {
    const payload: QrPayload = {
      v: 1,
      rsvpId: input.rsvpId,
      eventId: input.eventId,
      ...(input.showtimeId ? { showtimeId: input.showtimeId } : {}),
      issuedAt: input.issuedAt,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = cryptoSign(null, Buffer.from(body, 'utf8'), this.privateKey).toString('base64url');
    return `${body}.${sig}`;
  }

  /** Returns the verified payload, or null when the token or Ed25519 signature is invalid. */
  verify(token: string): QrPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, providedSig] = parts;
    if (!body || !providedSig) return null;

    try {
      const sigBytes = Buffer.from(providedSig, 'base64url');
      if (sigBytes.length !== 64) return null;

      const valid = cryptoVerify(null, Buffer.from(body, 'utf8'), this.publicKey, sigBytes);
      if (!valid) return null;

      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<
        Record<keyof QrPayload, unknown>
      >;
      if (
        parsed.v !== 1 ||
        typeof parsed.rsvpId !== 'string' ||
        typeof parsed.eventId !== 'string' ||
        typeof parsed.issuedAt !== 'number' ||
        (parsed.showtimeId !== undefined && typeof parsed.showtimeId !== 'string')
      ) {
        return null;
      }

      return {
        v: 1,
        rsvpId: parsed.rsvpId,
        eventId: parsed.eventId,
        ...(parsed.showtimeId ? { showtimeId: parsed.showtimeId } : {}),
        issuedAt: parsed.issuedAt,
      };
    } catch {
      return null;
    }
  }

  /** SHA-256 hex digest of the signed QR token for offline scanner roster lookups. */
  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
