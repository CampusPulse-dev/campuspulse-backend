import { validateEnv } from './env';

const baseEnv = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://campuspulse:campuspulse@localhost:5432/campuspulse?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-valid-jwt-secret-that-is-at-least-32-chars',
  QR_SIGNING_SECRET: 'a-valid-qr-secret-that-is-at-least-32-chars',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('validateEnv (S2-01)', () => {
  it('defaults DEV_AUTH_ENABLED to false', () => {
    const parsed = validateEnv(baseEnv);
    expect(parsed.DEV_AUTH_ENABLED).toBe(false);
  });

  it('parses DEV_AUTH_ENABLED="false" as false and "true" as true in non-production', () => {
    expect(validateEnv({ ...baseEnv, DEV_AUTH_ENABLED: 'false' }).DEV_AUTH_ENABLED).toBe(false);
    expect(validateEnv({ ...baseEnv, DEV_AUTH_ENABLED: 'true' }).DEV_AUTH_ENABLED).toBe(true);
    expect(
      validateEnv({ ...baseEnv, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true' }).DEV_AUTH_ENABLED,
    ).toBe(true);
  });

  it('rejects DEV_AUTH_ENABLED="true" when NODE_ENV="production"', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toThrow(/DEV_AUTH_ENABLED/);
  });

  it('allows NODE_ENV="production" when DEV_AUTH_ENABLED is false or omitted', () => {
    expect(validateEnv({ ...baseEnv, NODE_ENV: 'production' }).DEV_AUTH_ENABLED).toBe(false);
    expect(
      validateEnv({ ...baseEnv, NODE_ENV: 'production', DEV_AUTH_ENABLED: 'false' })
        .DEV_AUTH_ENABLED,
    ).toBe(false);
  });
});
