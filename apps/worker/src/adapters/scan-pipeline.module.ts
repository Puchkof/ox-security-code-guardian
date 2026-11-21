import { type Logger } from '@code-guardian/core';
import {
  GitCliCloner,
  StreamingTrivyReportParser,
  TmpWorkspaceProvider,
  TrivyCliScanner,
} from '@code-guardian/infrastructure';
import {
  LOGGER,
  REPORT_PARSER,
  REPOSITORY_CLONER,
  SECURITY_SCANNER,
  WORKSPACE_PROVIDER,
} from '@code-guardian/nest-common';
import { Global, Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type WorkerEnv } from '../config/env.schema';

/** Removes workspaces left behind by a crashed or OOM-killed worker before taking new jobs. */
class OrphanWorkspaceSweeper implements OnApplicationBootstrap {
  constructor(
    @Inject(WORKSPACE_PROVIDER) private readonly workspaces: TmpWorkspaceProvider,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly config: ConfigService<WorkerEnv, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const olderThanMs = this.config.get('ORPHAN_WORKSPACE_MAX_AGE_MS', { infer: true });
    try {
      const removed = await this.workspaces.sweepOrphans(olderThanMs);
      if (removed > 0) this.logger.info('Removed orphaned scan workspaces', { removed });
    } catch (error: unknown) {
      this.logger.warn('Orphaned workspace sweep failed', { error });
    }
  }
}

/** The clone → scan → parse adapters used by ExecuteScanHandler. */
@Global()
@Module({
  providers: [
    {
      provide: WORKSPACE_PROVIDER,
      useFactory: (config: ConfigService<WorkerEnv, true>) =>
        new TmpWorkspaceProvider({
          baseDir: config.get('SCAN_WORK_DIR', { infer: true }),
          minFreeBytes: config.get('MIN_FREE_BYTES', { infer: true }),
        }),
      inject: [ConfigService],
    },
    { provide: REPOSITORY_CLONER, useFactory: () => new GitCliCloner() },
    {
      provide: SECURITY_SCANNER,
      useFactory: (config: ConfigService<WorkerEnv, true>) => {
        const serverUrl = config.get('TRIVY_SERVER_URL', { infer: true });
        const cacheDir = config.get('TRIVY_CACHE_DIR', { infer: true });
        return new TrivyCliScanner({
          trivyBinary: config.get('TRIVY_BINARY', { infer: true }),
          ...(serverUrl === undefined ? {} : { serverUrl }),
          ...(cacheDir === undefined ? {} : { cacheDir }),
        });
      },
      inject: [ConfigService],
    },
    {
      provide: REPORT_PARSER,
      useFactory: (logger: Logger) => new StreamingTrivyReportParser({ logger }),
      inject: [LOGGER],
    },
    OrphanWorkspaceSweeper,
  ],
  exports: [WORKSPACE_PROVIDER, REPOSITORY_CLONER, SECURITY_SCANNER, REPORT_PARSER],
})
export class ScanPipelineModule {}
