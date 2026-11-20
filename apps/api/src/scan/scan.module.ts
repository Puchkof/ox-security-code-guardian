import {
  GetScanHandler,
  GetScanQuery,
  StartScanCommand,
  StartScanHandler,
  type Clock,
  type IdGenerator,
  type Logger,
  type ScanJobQueue,
  type ScanRepository,
  type VulnerabilityRepository,
} from '@code-guardian/core';
import { Module } from '@nestjs/common';
import { bindCommandHandler, bindQueryHandler } from '@code-guardian/nest-common';
import {
  CLOCK,
  ID_GENERATOR,
  LOGGER,
  SCAN_JOB_QUEUE,
  SCAN_REPOSITORY,
  VULNERABILITY_REPOSITORY,
} from '@code-guardian/nest-common';
import { ScanResolver } from './graphql/scan.resolver';
import { ScanController } from './http/scan.controller';

/**
 * Scan use cases exposed over REST and GraphQL.
 * Ports are resolved from whatever global adapter modules the root imports.
 */
@Module({
  controllers: [ScanController],
  providers: [
    {
      provide: StartScanHandler,
      useFactory: (
        scans: ScanRepository,
        queue: ScanJobQueue,
        ids: IdGenerator,
        clock: Clock,
        logger: Logger,
      ) => new StartScanHandler(scans, queue, ids, clock, logger),
      inject: [SCAN_REPOSITORY, SCAN_JOB_QUEUE, ID_GENERATOR, CLOCK, LOGGER],
    },
    {
      provide: GetScanHandler,
      useFactory: (scans: ScanRepository, vulnerabilities: VulnerabilityRepository) =>
        new GetScanHandler(scans, vulnerabilities),
      inject: [SCAN_REPOSITORY, VULNERABILITY_REPOSITORY],
    },
    bindCommandHandler(StartScanCommand, StartScanHandler),
    bindQueryHandler(GetScanQuery, GetScanHandler),
    ScanResolver,
  ],
})
export class ScanModule {}
