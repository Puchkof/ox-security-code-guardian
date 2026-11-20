import { PrismaClient } from '@prisma/client';

export interface PrismaClientOptions {
  /** Log Prisma warnings and errors to stdout. */
  readonly logQueries?: boolean;
}

/**
 * Creates a PrismaClient bound to an explicit URL instead of reading `DATABASE_URL`
 * implicitly, so configuration stays in the composition root.
 * Tune the pool with `?connection_limit=` in the URL; keep it small in a 200MB container.
 */
export function createPrismaClient(
  databaseUrl: string,
  options: PrismaClientOptions = {},
): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids that cannot be stored in a `uuid` column cannot exist, so lookups can short-circuit. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
