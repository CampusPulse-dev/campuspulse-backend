import { generateKeyPairSync } from 'node:crypto';
import { validateEnv } from './env';

const runtimeEd25519Key = generateKeyPairSync('ed25519')
  .privateKey.export({ format: 'der', type: 'pkcs8' })
  .toString('base64');

const baseEnv = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://campuspulse:campuspulse@localhost:5432/campuspulse?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-valid-jwt-secret-that-is-at-least-32-chars',
  QR_SIGNING_SECRET: 'a-valid-qr-secret-that-is-at-least-32-chars',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('validateEnv (S2-01 & S3-01)', () => {
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
        QR_SIGNING_PRIVATE_KEY: runtimeEd25519Key,
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toThrow(/DEV_AUTH_ENABLED/);
  });

  it('requires a valid PKCS#8 Ed25519 QR_SIGNING_PRIVATE_KEY in production', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(
      /QR_SIGNING_PRIVATE_KEY/,
    );
    expect(() =>
      validateEnv({ ...baseEnv, QR_SIGNING_PRIVATE_KEY: 'not-a-valid-pkcs8-key' }),
    ).toThrow(/QR_SIGNING_PRIVATE_KEY/);

    const prod = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      QR_SIGNING_PRIVATE_KEY: runtimeEd25519Key,
      EMAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 'test-only-key',
      EMAIL_FROM: 'test@example.com',
    });
    expect(prod.DEV_AUTH_ENABLED).toBe(false);
    expect(prod.QR_SIGNING_PRIVATE_KEY).toBe(runtimeEd25519Key);
  });
  it('refuses a production memory transport and incomplete Resend credentials', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        QR_SIGNING_PRIVATE_KEY: runtimeEd25519Key,
      }),
    ).toThrow(/EMAIL_TRANSPORT/);
    expect(() => validateEnv({ ...baseEnv, EMAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
  });
});
