import { InMemoryKeyValueStore } from '../../../common/kv/key-value-store';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma.service';
import type { Env } from '../../../config/env';
import { AuthService, REFRESH_GRACE_SECONDS, parseDurationSeconds } from './auth.service';
import { PasswordService } from './password.service';

type Row = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'ATTENDEE';
  isVerifiedStudent: boolean;
  refreshTokenHash: string | null;
};

const USER_ID = '11111111-1111-4111-8111-111111111111';

/** In-memory stand-in for the handful of `prisma.user` calls AuthService makes. */
function buildService() {
  const rows = new Map<string, Row>();

  const user = {
    create: jest.fn(({ data }: { data: Pick<Row, 'email' | 'passwordHash' | 'displayName'> }) => {
      if ([...rows.values()].some((r) => r.email === data.email)) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
        );
      }
      const row: Row = {
        id: USER_ID,
        avatarUrl: null,
        role: 'ATTENDEE',
        isVerifiedStudent: false,
        refreshTokenHash: null,
        ...data,
      };
      rows.set(row.id, row);
      return Promise.resolve({ ...row });
    }),
    findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) => {
      const row = where.id
        ? rows.get(where.id)
        : [...rows.values()].find((r) => r.email === where.email);
      return Promise.resolve(row ? { ...row } : null);
    }),
    update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.get(where.id);
      if (row) Object.assign(row, data);
      return Promise.resolve(row);
    }),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string; refreshTokenHash?: string };
        data: Partial<Row>;
      }) => {
        const row = rows.get(where.id);
        if (!row) return Promise.resolve({ count: 0 });
        if (
          where.refreshTokenHash !== undefined &&
          row.refreshTokenHash !== where.refreshTokenHash
        ) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      },
    ),
  };

  const env: Partial<Env> = { JWT_EXPIRES_IN: '15m', JWT_REFRESH_TTL_DAYS: 30 };
  const config = {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
  const store = new InMemoryKeyValueStore();
  const jwt = new JwtService({ secret: 'unit-test-secret-value-at-least-32-chars' });

  const service = new AuthService(
    { user } as unknown as PrismaService,
    jwt,
    config,
    new PasswordService(),
    store,
  );
  return { service, rows, jwt, store };
}

const SIGN_UP = { email: 'Tobi@Stu.UI.edu.ng', password: 'a-long-password', displayName: 'Tobi' };

describe('AuthService (S1-02)', () => {
  it('parses access-token durations', () => {
    expect(parseDurationSeconds('900')).toBe(900);
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('7d')).toBe(604_800);
    expect(() => parseDurationSeconds('soon')).toThrow();
  });

  it('signs up with a normalised email, a scrypt hash and a usable access token', async () => {
    const { service, rows } = buildService();
    const issued = await service.signUp(SIGN_UP);

    const row = rows.get(USER_ID);
    expect(row?.email).toBe('tobi@stu.ui.edu.ng');
    expect(row?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(issued.session.expiresIn).toBe(900);
    expect(issued.session.user).toEqual({
      id: USER_ID,
      displayName: 'Tobi',
      avatarUrl: null,
      role: 'ATTENDEE',
      isVerifiedStudent: false,
    });
    // Only the hash of the refresh secret is stored.
    expect(row?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.refreshToken).not.toContain(row?.refreshTokenHash ?? 'missing');

    await expect(
      service.authenticateAccessToken(issued.session.accessToken),
    ).resolves.toMatchObject({
      id: USER_ID,
      email: 'tobi@stu.ui.edu.ng',
      role: 'ATTENDEE',
    });
  });

  it('rejects a duplicate email with 409', async () => {
    const { service } = buildService();
    await service.signUp(SIGN_UP);
    await expect(service.signUp(SIGN_UP)).rejects.toBeInstanceOf(ConflictException);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const { service } = buildService();
    await service.signUp(SIGN_UP);
    await expect(
      service.signIn({ email: SIGN_UP.email, password: 'nope-nope-nope' }),
    ).rejects.toThrow('Invalid email or password');
    await expect(
      service.signIn({ email: 'ghost@stu.ui.edu.ng', password: 'whatever' }),
    ).rejects.toThrow('Invalid email or password');
  });

  it('rotates the refresh token and revokes the session when an old one is replayed', async () => {
    const { service, rows, store } = buildService();
    const first = await service.signUp(SIGN_UP);
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toEqual(first.refreshToken);

    // Past the grace window, a replay of the rotated-out token is rejected and the live
    // session dies with it.
    store.advance(REFRESH_GRACE_SECONDS + 1);
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.get(USER_ID)?.refreshTokenHash).toBeNull();
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('keeps the session when a refresh answer was lost, once, inside the grace window', async () => {
    const { service, rows } = buildService();
    const first = await service.signUp(SIGN_UP);
    // The browser sent the refresh but navigated away before storing the answer.
    const lost = await service.refresh(first.refreshToken);

    const recovered = await service.refresh(first.refreshToken);
    expect(recovered.refreshToken).not.toEqual(lost.refreshToken);
    // The answer that never arrived is dead; the recovered one is the live session.
    await expect(service.refresh(recovered.refreshToken)).resolves.toBeDefined();
    expect(rows.get(USER_ID)?.refreshTokenHash).not.toBeNull();
  });

  it('allows the grace token only once, then treats it as a replay', async () => {
    const { service, rows } = buildService();
    const first = await service.signUp(SIGN_UP);
    await service.refresh(first.refreshToken);
    await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.get(USER_ID)?.refreshTokenHash).toBeNull();
  });

  it('gives no grace after sign-out', async () => {
    const { service } = buildService();
    const first = await service.signUp(SIGN_UP);
    const second = await service.refresh(first.refreshToken);
    await service.signOut(second.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects missing and malformed refresh tokens', async () => {
    const { service } = buildService();
    const malformed = [
      undefined,
      '',
      'garbage',
      `${USER_ID}.short`,
      `not-a-uuid.${'x'.repeat(43)}`,
    ];
    for (const token of malformed) {
      await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('sign-out invalidates the refresh token and is idempotent', async () => {
    const { service, rows } = buildService();
    const issued = await service.signUp(SIGN_UP);
    await service.signOut(issued.refreshToken);
    expect(rows.get(USER_ID)?.refreshTokenHash).toBeNull();
    await expect(service.signOut(issued.refreshToken)).resolves.toBeUndefined();
    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects forged, foreign-secret and orphaned access tokens', async () => {
    const { service, rows, jwt } = buildService();
    const issued = await service.signUp(SIGN_UP);

    await expect(service.authenticateAccessToken('not.a.jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const foreign = await new JwtService({ secret: 'x'.repeat(40) }).signAsync({ sub: USER_ID });
    await expect(service.authenticateAccessToken(foreign)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const badSubject = await jwt.signAsync({ sub: 'admin' });
    await expect(service.authenticateAccessToken(badSubject)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    rows.delete(USER_ID);
    await expect(
      service.authenticateAccessToken(issued.session.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
