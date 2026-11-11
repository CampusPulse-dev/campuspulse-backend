import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/common/prisma.service';
import type { SessionResponse, UserPublic } from '../src/contract';
import { anon, asUser, bodyOf, createTestApp, truncateDatabase, withToken } from './utils/app';

const ACCOUNT = {
  email: 'ada@stu.ui.edu.ng',
  password: 'a-long-enough-password',
  displayName: 'Ada',
};

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const found = cookies.find((c) => c.startsWith('cp_refresh='));
  if (!found) throw new Error('cp_refresh cookie was not set');
  return found;
}

describe('Auth lifecycle & RBAC (S1-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // Real JWT only: prove nothing in here leans on the X-Dev-User fallback.
    ({ app, prisma, close } = await createTestApp({ devAuthEnabled: false }));
  });

  beforeEach(async () => {
    await truncateDatabase(prisma);
  });

  afterAll(async () => {
    await close();
  });

  it('sign-up, /users/me, refresh rotation, sign-out', async () => {
    const signUp = await anon(app).post('/auth/sign-up').send(ACCOUNT).expect(201);
    const session = bodyOf<SessionResponse>(signUp);
    expect(session.user).toMatchObject({ displayName: 'Ada', role: 'ATTENDEE' });
    expect(session.expiresIn).toBeGreaterThan(0);

    const cookie = refreshCookie(signUp);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');

    const me = await withToken(app, session.accessToken).get('/users/me').expect(200);
    expect(bodyOf<UserPublic>(me).id).toBe(session.user.id);

    const refreshed = await anon(app).post('/auth/refresh').set('Cookie', cookie).expect(200);
    const nextCookie = refreshCookie(refreshed);
    expect(nextCookie.split(';')[0]).not.toEqual(cookie.split(';')[0]);
    await withToken(app, bodyOf<SessionResponse>(refreshed).accessToken)
      .get('/users/me')
      .expect(200);

    // Replaying the rotated-out cookie is refused and revokes the live session.
    await anon(app).post('/auth/refresh').set('Cookie', cookie).expect(401);
    await anon(app).post('/auth/refresh').set('Cookie', nextCookie).expect(401);

    const signIn = await anon(app)
      .post('/auth/sign-in')
      .send({ email: 'ADA@stu.ui.edu.ng', password: ACCOUNT.password })
      .expect(200);
    const liveCookie = refreshCookie(signIn);
    const signOut = await anon(app).post('/auth/sign-out').set('Cookie', liveCookie).expect(204);
    expect(refreshCookie(signOut)).toMatch(/^cp_refresh=;/);
    await anon(app).post('/auth/refresh').set('Cookie', liveCookie).expect(401);
  });

  it('never stores the password, and rejects bad credentials uniformly', async () => {
    await anon(app).post('/auth/sign-up').send(ACCOUNT).expect(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: ACCOUNT.email } });
    expect(row.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(row.passwordHash).not.toContain(ACCOUNT.password);

    await anon(app).post('/auth/sign-up').send(ACCOUNT).expect(409);
    await anon(app)
      .post('/auth/sign-up')
      .send({ ...ACCOUNT, email: 'b@stu.ui.edu.ng', password: 'short' })
      .expect(400);

    const wrong = await anon(app)
      .post('/auth/sign-in')
      .send({ email: ACCOUNT.email, password: 'wrong-password-here' })
      .expect(401);
    const unknown = await anon(app)
      .post('/auth/sign-in')
      .send({ email: 'ghost@stu.ui.edu.ng', password: 'wrong-password-here' })
      .expect(401);
    expect(bodyOf<{ message: string }>(wrong).message).toEqual(
      bodyOf<{ message: string }>(unknown).message,
    );
  });

  it('requires a valid Bearer token and ignores X-Dev-User when dev auth is off', async () => {
    await anon(app).get('/users/me').expect(401);
    await withToken(app, 'not-a-token').get('/users/me').expect(401);
    await asUser(app, 'tobi@stu.ui.edu.ng').get('/users/me').expect(401);
    // Public routes stay public, but a bad token is still a 401 so clients refresh.
    await anon(app).get('/events/feed').expect(200);
    await withToken(app, 'not-a-token').get('/events/feed').expect(401);
  });

  it('applies a role change on the very next request', async () => {
    const signUp = await anon(app).post('/auth/sign-up').send(ACCOUNT).expect(201);
    const { accessToken, user } = bodyOf<SessionResponse>(signUp);

    await prisma.user.update({ where: { id: user.id }, data: { role: 'MODERATOR' } });
    const me = await withToken(app, accessToken).get('/users/me').expect(200);
    expect(bodyOf<UserPublic>(me).role).toBe('MODERATOR');

    await prisma.user.delete({ where: { id: user.id } });
    await withToken(app, accessToken).get('/users/me').expect(401);
  });

  it('throttles credential stuffing on sign-in', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await anon(app)
        .post('/auth/sign-in')
        .send({ email: ACCOUNT.email, password: `guess-number-${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
