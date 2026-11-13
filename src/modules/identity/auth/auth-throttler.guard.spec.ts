import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Env } from '../../../config/env';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { sealRefreshCookie } from './refresh-cookie';

const SECRET = 'unit-test-secret-value-at-least-32-chars';
const USER_ID = '11111111-1111-4111-8111-111111111111';

class Probe extends AuthThrottlerGuard {
  track(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}

function guard() {
  const config = { get: () => SECRET } as unknown as ConfigService<Env, true>;
  return new Probe({ throttlers: [] }, {} as ThrottlerStorage, new Reflector(), config);
}

const campus = '10.0.0.1';

describe('AuthThrottlerGuard', () => {
  it('counts refreshes per account, so students behind one campus address do not share a limit', async () => {
    const cookie = `cp_refresh=${encodeURIComponent(sealRefreshCookie(`${USER_ID}.secret`, SECRET))}`;
    await expect(
      guard().track({ ip: campus, path: '/api/v1/auth/refresh', headers: { cookie } }),
    ).resolves.toBe(`session:${USER_ID}`);
  });

  it('falls back to the address when the refresh cookie is missing or forged', async () => {
    for (const cookie of [undefined, 'cp_refresh=v1.forged.value.here']) {
      await expect(
        guard().track({ ip: campus, path: '/api/v1/auth/refresh', headers: { cookie } }),
      ).resolves.toBe(`ip:${campus}`);
    }
  });

  it('counts sign-ins per address and email, without keeping the email', async () => {
    const tracker = await guard().track({
      ip: campus,
      path: '/api/v1/auth/sign-in',
      headers: {},
      body: { email: ' Tobi@Stu.UI.edu.ng ' },
    });
    const prefix = `credential:${campus}:`;
    expect(tracker.startsWith(prefix)).toBe(true);
    expect(tracker.slice(prefix.length)).toMatch(/^[0-9a-f]{32}$/);
    expect(tracker).not.toContain('tobi');
    const other = await guard().track({
      ip: campus,
      path: '/api/v1/auth/sign-in',
      headers: {},
      body: { email: 'ada@stu.ui.edu.ng' },
    });
    expect(other).not.toBe(tracker);
    const same = await guard().track({
      ip: campus,
      path: '/api/v1/auth/sign-in',
      headers: {},
      body: { email: 'tobi@stu.ui.edu.ng' },
    });
    expect(same).toBe(tracker);
  });
});
