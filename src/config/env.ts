import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

function isValidEd25519Pkcs8Base64(value: string): boolean {
  try {
    const der = Buffer.from(value, 'base64');
    if (der.length === 0) return false;
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return key.asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/**
 * Fail fast on boot rather than at the first request that needs a
 * missing variable. Render restarts a crashed service; it does not
 * restart one that is quietly misconfigured.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** Access-token lifetime (`900`, `15m`, `1h`). Short: the refresh cookie carries the session. */
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+\s*[smhd]?$/, 'JWT_EXPIRES_IN must look like 900, 15m, 1h or 7d')
      .default('15m'),
    /** Refresh-cookie lifetime; each refresh rotates the token and restarts this window. */
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Legacy dev/CI seed fallback when QR_SIGNING_PRIVATE_KEY is omitted outside production. */
    QR_SIGNING_SECRET: z.string().min(32).optional(),
    /** PKCS#8 DER base64 Ed25519 private key; public key is derived for offline scanners. */
    QR_SIGNING_PRIVATE_KEY: z
      .string()
      .min(1)
      .refine(isValidEd25519Pkcs8Base64, {
        message: 'QR_SIGNING_PRIVATE_KEY must be a base64-encoded PKCS#8 Ed25519 private key',
      })
      .optional(),
    WEB_ORIGIN: z.url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Enables the X-Dev-User fallback for local development and e2e suites only. */
    DEV_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    S3_ENDPOINT: z.url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).default('campuspulse-media'),
    S3_ACCESS_KEY_ID: z.string().min(1).default('minioadmin'),
    S3_SECRET_ACCESS_KEY: z.string().min(8).default('minioadminpassword'),
    /** Never public-read. Holds student ID images until a verification decision deletes them. */
    S3_PRIVATE_BUCKET: z.string().min(1).default('campuspulse-private'),
    S3_PUBLIC_BASE_URL: z.url().default('http://localhost:9000/campuspulse-media'),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).default('mailto:alerts@campuspulse.ng'),
    EMAIL_TRANSPORT: z.enum(['memory', 'resend']).default('memory'),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z
      .string()
      .refine(
        (value) =>
          !/[\r\n]/.test(value) &&
          z.email().safeParse(value.match(/<([^<>]+)>$/)?.[1] ?? value).success,
        'EMAIL_FROM must contain a valid sender email',
      )
      .optional(),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEV_AUTH_ENABLED), {
    message: 'DEV_AUTH_ENABLED must not be true when NODE_ENV is production',
    path: ['DEV_AUTH_ENABLED'],
  })
  .refine((env) => !(env.NODE_ENV === 'production' && !env.QR_SIGNING_PRIVATE_KEY), {
    message: 'QR_SIGNING_PRIVATE_KEY is required when NODE_ENV is production',
    path: ['QR_SIGNING_PRIVATE_KEY'],
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT !== 'resend'), {
    message: 'Production requires EMAIL_TRANSPORT=resend',
    path: ['EMAIL_TRANSPORT'],
  })
  .refine((env) => env.EMAIL_TRANSPORT !== 'resend' || (!!env.RESEND_API_KEY && !!env.EMAIL_FROM), {
    message: 'Resend requires RESEND_API_KEY and EMAIL_FROM',
    path: ['RESEND_API_KEY'],
  });

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
