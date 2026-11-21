import {
  createPrismaClient,
  PrismaScanRepository,
  PrismaVulnerabilityRepository,
} from '@code-guardian/infrastructure';
import {
  InMemoryScanRepository,
  InMemoryVulnerabilityRepository,
} from '@code-guardian/core/testing';
import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT, SCAN_REPOSITORY, VULNERABILITY_REPOSITORY } from './port.tokens';

/** Disconnects the pool on shutdown so the process can exit cleanly. */
class PrismaLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Scan + vulnerability repositories.
 *  - `prisma()`: PostgreSQL via Prisma; needs DATABASE_URL in config.
 *  - `inMemory()`: process-local fakes for tests and the zero-dependency demo mode.
 */
@Global()
@Module({})
export class PersistenceModule {
  static prisma(): DynamicModule {
    return {
      module: PersistenceModule,
      providers: [
        {
          provide: PRISMA_CLIENT,
          useFactory: (config: ConfigService) =>
            createPrismaClient(config.getOrThrow<string>('DATABASE_URL')),
          inject: [ConfigService],
        },
        {
          provide: SCAN_REPOSITORY,
          useFactory: (prisma: PrismaClient) => new PrismaScanRepository(prisma),
          inject: [PRISMA_CLIENT],
        },
        {
          provide: VULNERABILITY_REPOSITORY,
          useFactory: (prisma: PrismaClient) => new PrismaVulnerabilityRepository(prisma),
          inject: [PRISMA_CLIENT],
        },
        PrismaLifecycle,
      ],
      exports: [PRISMA_CLIENT, SCAN_REPOSITORY, VULNERABILITY_REPOSITORY],
    };
  }

  static inMemory(): DynamicModule {
    return {
      module: PersistenceModule,
      providers: [
        { provide: SCAN_REPOSITORY, useFactory: () => new InMemoryScanRepository() },
        {
          provide: VULNERABILITY_REPOSITORY,
          useFactory: () => new InMemoryVulnerabilityRepository(),
        },
      ],
      exports: [SCAN_REPOSITORY, VULNERABILITY_REPOSITORY],
    };
  }
}
