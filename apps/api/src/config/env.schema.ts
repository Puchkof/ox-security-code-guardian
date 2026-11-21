import { z } from 'zod';

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: logLevel.default('info'),
  /** Comma-separated list of origins allowed to call the API from a browser (the web app). */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  // Required by the default `infrastructure` adapters (checked when they are created).
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
});

export type ApiEnv = z.output<typeof apiEnvSchema>;

/** `ConfigModule` validate hook: fails fast with every invalid variable listed. */
export function validateApiEnv(raw: Record<string, unknown>): ApiEnv {
  const result = apiEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
