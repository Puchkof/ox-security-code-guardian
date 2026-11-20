import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const positiveInt = z.coerce.number().int().positive();

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevel.default('info'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  /** Parallel scans per worker process. Keep at 1 under the 150MB heap budget. */
  WORKER_CONCURRENCY: positiveInt.max(16).default(1),
  CLONE_TIMEOUT_MS: positiveInt.default(120_000),
  SCAN_TIMEOUT_MS: positiveInt.default(600_000),
  /** Findings buffered in memory before each database flush. */
  BATCH_SIZE: positiveInt.max(10_000).default(500),
  SCAN_WORK_DIR: z.string().min(1).default(join(tmpdir(), 'code-guardian')),
  /** A scan is refused (retryably) when the work dir has less free space than this. */
  MIN_FREE_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(1024 ** 3),
  /** Workspaces older than this found at startup belong to a dead worker and are deleted. */
  ORPHAN_WORKSPACE_MAX_AGE_MS: positiveInt.default(60 * 60 * 1000),
  TRIVY_BINARY: z.string().min(1).default('trivy'),
  /**
   * Client/server mode: the vulnerability DB and matching run in the Trivy server, so the
   * worker container only pays for file analysis. Unset = standalone (DB in TRIVY_CACHE_DIR).
   */
  TRIVY_SERVER_URL: z.url().optional(),
  TRIVY_CACHE_DIR: z.string().min(1).optional(),
  DATABASE_URL: z.url(),
});

export type WorkerEnv = z.output<typeof workerEnvSchema>;

/** `ConfigModule` validate hook: fails fast with every invalid variable listed. */
export function validateWorkerEnv(raw: Record<string, unknown>): WorkerEnv {
  const result = workerEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
