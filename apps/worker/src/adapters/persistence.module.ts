import {
  InMemoryScanRepository,
  InMemoryVulnerabilityRepository,
} from '@code-guardian/core/testing';
import { Global, Module } from '@nestjs/common';
import { SCAN_REPOSITORY, VULNERABILITY_REPOSITORY } from '../shared/port.tokens';

/**
 * Persistence adapters.
 * TODO(infrastructure): replace the in-memory fakes with PrismaScanRepository and
 * PrismaVulnerabilityRepository from @code-guardian/infrastructure. Only these providers change.
 */
@Global()
@Module({
  providers: [
    { provide: SCAN_REPOSITORY, useFactory: () => new InMemoryScanRepository() },
    { provide: VULNERABILITY_REPOSITORY, useFactory: () => new InMemoryVulnerabilityRepository() },
  ],
  exports: [SCAN_REPOSITORY, VULNERABILITY_REPOSITORY],
})
export class PersistenceModule {}
