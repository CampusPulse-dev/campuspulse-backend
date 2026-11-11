import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User } from '@prisma/client';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { toUserPublic } from '../../../common/mappers/entity.mappers';
import { PrismaService } from '../../../common/prisma.service';
import type { Env } from '../../../config/env';
import type { SessionResponse, SignInBody, SignUpBody, UserRole } from '../../../contract';
import { PasswordService } from './password.service';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

/** A session plus the opaque refresh token the controller puts in the httpOnly cookie. */
export interface IssuedSession {
  session: SessionResponse;
  refreshToken: string;
  refreshMaxAgeMs: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** `900`, `15m`, `1h`, `7d` → seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  const seconds = Number(match[1]) * (DURATION_UNITS[match[2] ?? 's'] ?? 1);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`Unsupported duration: ${value}`);
  }
  return seconds;
}

function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Short-lived access JWT + rotating opaque refresh token.
 *
 * The refresh token is `<userId>.<secret>`; only sha256(secret) is stored
 * (`User.refreshTokenHash`). Every refresh rotates it. Presenting a token
 * that is no longer current means it was replayed, so the session is revoked.
 */
@Injectable()
export class AuthService {
  // Burned on unknown emails so sign-in timing does not reveal which accounts exist.
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly passwords: PasswordService,
  ) {}

  async signUp(body: SignUpBody): Promise<IssuedSession> {
    const email = body.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(body.password);

    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash, displayName: body.displayName.trim() },
      });
      return await this.issueSession(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  async signIn(body: SignInBody): Promise<IssuedSession> {
    const email = body.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      this.dummyHash ??= this.passwords.hash('campuspulse-timing-equaliser');
      await this.passwords.verify(body.password, await this.dummyHash);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await this.passwords.verify(body.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Checked only after the password, so suspension is not revealed to strangers.
    if (user.suspendedAt) throw new ForbiddenException('This account is suspended');
    return this.issueSession(user);
  }

  async refresh(rawToken: string | undefined): Promise<IssuedSession> {
    const parsed = this.parseRefreshToken(rawToken);
    if (!parsed) throw new UnauthorizedException('Session expired');

    const user = await this.prisma.user.findUnique({ where: { id: parsed.userId } });
    if (!user?.refreshTokenHash || user.suspendedAt) {
      throw new UnauthorizedException('Session expired');
    }

    const presentedHash = hashRefreshSecret(parsed.secret);
    if (!safeEqualHex(presentedHash, user.refreshTokenHash)) {
      // A rotated-out token is being replayed: kill the live session too.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: null },
      });
      throw new UnauthorizedException('Session expired');
    }

    return this.issueSession(user, user.refreshTokenHash);
  }

  /** Idempotent: an unknown or stale cookie still results in a cleared session. */
  async signOut(rawToken: string | undefined): Promise<void> {
    const parsed = this.parseRefreshToken(rawToken);
    if (!parsed) return;
    await this.prisma.user.updateMany({
      where: { id: parsed.userId, refreshTokenHash: hashRefreshSecret(parsed.secret) },
      data: { refreshTokenHash: null },
    });
  }

  /** Resolves a Bearer token to the live user row, so role changes apply immediately. */
  async authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, suspendedAt: true },
    });
    if (!user) throw new UnauthorizedException('Invalid or expired access token');
    if (user.suspendedAt) throw new ForbiddenException('This account is suspended');
    return { id: user.id, email: user.email, role: user.role };
  }

  refreshMaxAgeMs(): number {
    return this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  private parseRefreshToken(
    rawToken: string | undefined,
  ): { userId: string; secret: string } | null {
    if (!rawToken) return null;
    const separator = rawToken.indexOf('.');
    if (separator <= 0) return null;
    const userId = rawToken.slice(0, separator);
    const secret = rawToken.slice(separator + 1);
    if (!UUID_PATTERN.test(userId) || secret.length < 32 || secret.length > 128) return null;
    return { userId, secret };
  }

  /**
   * `expectedHash` makes rotation atomic: two concurrent refreshes with the
   * same token cannot both succeed.
   */
  private async issueSession(user: User, expectedHash?: string): Promise<IssuedSession> {
    const secret = randomBytes(32).toString('base64url');
    const rotated = await this.prisma.user.updateMany({
      where: { id: user.id, ...(expectedHash ? { refreshTokenHash: expectedHash } : {}) },
      data: { refreshTokenHash: hashRefreshSecret(secret) },
    });
    if (rotated.count !== 1) throw new UnauthorizedException('Session expired');

    const expiresIn = parseDurationSeconds(this.config.get('JWT_EXPIRES_IN', { infer: true }));
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });

    return {
      session: { user: toUserPublic(user), accessToken, expiresIn },
      refreshToken: `${user.id}.${secret}`,
      refreshMaxAgeMs: this.refreshMaxAgeMs(),
    };
  }
}
