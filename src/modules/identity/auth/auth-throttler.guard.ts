import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  getOptionsToken,
  getStorageToken,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Env } from '../../../config/env';
import { openRefreshCookie } from './refresh-cookie';

const REFRESH_COOKIE = 'cp_refresh';

function cookieValue(header: unknown, name: string): string | undefined {
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Rate-limits the credential routes by *who*, not just by IP address.
 *
 * Thousands of students reach us through one campus NAT address, and every
 * request arrives through the hosting proxy, so an IP-only key would let ten
 * sign-ins a minute lock out the whole campus. Instead:
 * - refresh / sign-out count per account (read from the sealed refresh cookie);
 * - sign-in / sign-up count per address *and* email, so guessing one account's
 *   password is still capped. Emails are hashed: no address is kept in the
 *   limiter's storage (NDPA).
 * Requests without a usable identity fall back to the IP key.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {
    super(options, storage, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ip = await super.getTracker(req);
    const rawPath = req.path ?? req.url;
    const path = typeof rawPath === 'string' ? rawPath : '';

    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/sign-out')) {
      const token = openRefreshCookie(
        cookieValue(headers.cookie, REFRESH_COOKIE),
        this.config.get('JWT_SECRET', { infer: true }),
      );
      const userId = token?.split('.')[0];
      return userId ? `session:${userId}` : `ip:${ip}`;
    }

    const email = body.email;
    if (typeof email === 'string' && email.trim()) {
      return `credential:${ip}:${digest(email.trim().toLowerCase())}`;
    }
    return `ip:${ip}`;
  }
}
