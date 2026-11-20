import {
  ExecuteScanCommand,
  ExecuteScanHandler,
  type Clock,
  type Logger,
  type ReportParser,
  type RepositoryCloner,
  type ScanPipelineConfig,
  type ScanRepository,
  type SecurityScanner,
  type VulnerabilityRepository,
  type WorkspaceProvider,
} from '@code-guardian/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type WorkerEnv } from '../config/env.schema';
import { bindCommandHandler } from '../shared/cqrs-binding';
import {
  CLOCK,
  LOGGER,
  REPORT_PARSER,
  REPOSITORY_CLONER,
  SCAN_PIPELINE_CONFIG,
  SCAN_REPOSITORY,
  SECURITY_SCANNER,
  VULNERABILITY_REPOSITORY,
  WORKSPACE_PROVIDER,
} from '../shared/port.tokens';
import { SCAN_QUEUE_NAME, WORKER_CONCURRENCY } from './scan-queue';
import { ScanProcessor } from './scan.processor';

/**
 * The scan job consumer. Needs BullModule.forRoot, CqrsModule.forRoot, ConfigModule and
 * the port adapters from the root, so it composes into a single-process entrypoint too.
 */
@Module({
  // registerQueue also loads @nestjs/bullmq's explorer, which creates the Worker for @Processor.
  imports: [BullModule.registerQueue({ name: SCAN_QUEUE_NAME })],
  providers: [
    {
      provide: SCAN_PIPELINE_CONFIG,
      useFactory: (config: ConfigService<WorkerEnv, true>): ScanPipelineConfig => ({
        cloneTimeoutMs: config.get('CLONE_TIMEOUT_MS', { infer: true }),
        scanTimeoutMs: config.get('SCAN_TIMEOUT_MS', { infer: true }),
        batchSize: config.get('BATCH_SIZE', { infer: true }),
      }),
      inject: [ConfigService],
    },
    {
      provide: WORKER_CONCURRENCY,
      useFactory: (config: ConfigService<WorkerEnv, true>): number =>
        config.get('WORKER_CONCURRENCY', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: ExecuteScanHandler,
      useFactory: (
        scans: ScanRepository,
        vulnerabilities: VulnerabilityRepository,
        workspaces: WorkspaceProvider,
        cloner: RepositoryCloner,
        scanner: SecurityScanner,
        parser: ReportParser,
        clock: Clock,
        logger: Logger,
        config: ScanPipelineConfig,
      ) =>
        new ExecuteScanHandler(
          scans,
          vulnerabilities,
          workspaces,
          cloner,
          scanner,
          parser,
          clock,
          logger,
          config,
        ),
      inject: [
        SCAN_REPOSITORY,
        VULNERABILITY_REPOSITORY,
        WORKSPACE_PROVIDER,
        REPOSITORY_CLONER,
        SECURITY_SCANNER,
        REPORT_PARSER,
        CLOCK,
        LOGGER,
        SCAN_PIPELINE_CONFIG,
      ],
    },
    bindCommandHandler(ExecuteScanCommand, ExecuteScanHandler),
    ScanProcessor,
  ],
})
export class ScanWorkerModule {}
