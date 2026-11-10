import { z } from 'zod';

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
    JWT_EXPIRES_IN: z.string().default('7d'),
    /** Separate from JWT_SECRET: QR tokens outlive sessions and rotate independently. */
    QR_SIGNING_SECRET: z.string().min(32, 'QR_SIGNING_SECRET must be at least 32 characters'),
    WEB_ORIGIN: z.url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // TODO(S1-02): replace with JWT and remove DEV_AUTH_ENABLED.
    DEV_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEV_AUTH_ENABLED), {
    message: 'DEV_AUTH_ENABLED must not be true when NODE_ENV is production',
    path: ['DEV_AUTH_ENABLED'],
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
