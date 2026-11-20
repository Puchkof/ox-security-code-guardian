import { join } from 'node:path';
import {
  type ReportParser,
  type RepositoryCloner,
  type ScanWorkspace,
  type SecurityScanner,
  type Vulnerability,
  type WorkspaceProvider,
} from '@code-guardian/core';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type WorkerEnv } from '../config/env.schema';
import {
  REPORT_PARSER,
  REPOSITORY_CLONER,
  SECURITY_SCANNER,
  WORKSPACE_PROVIDER,
} from '../shared/port.tokens';
import { AdapterNotConfiguredError } from './adapter-not-configured.error';

/** TODO(infrastructure): TmpWorkspaceProvider (SCAN_WORK_DIR, MIN_FREE_BYTES). */
class PlaceholderWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly workDir: string) {}

  create(scanId: string): Promise<ScanWorkspace> {
    const root = join(this.workDir, scanId);
    return Promise.resolve({
      sourceDir: join(root, 'repo'),
      reportFile: join(root, 'report.json'),
      dispose: () => Promise.resolve(),
    });
  }
}

/** TODO(infrastructure): GitCliCloner (CLONE_TIMEOUT_MS is applied by the core handler). */
class PlaceholderCloner implements RepositoryCloner {
  clone(): Promise<void> {
    return Promise.reject(new AdapterNotConfiguredError('RepositoryCloner'));
  }
}

/** TODO(infrastructure): TrivyCliScanner (TRIVY_SERVER_URL for client/server mode). */
class PlaceholderScanner implements SecurityScanner {
  scan(): Promise<void> {
    return Promise.reject(new AdapterNotConfiguredError('SecurityScanner'));
  }
}

/** TODO(infrastructure): StreamingTrivyReportParser. */
class PlaceholderReportParser implements ReportParser {
  stream(): AsyncIterable<Vulnerability> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new AdapterNotConfiguredError('ReportParser')),
      }),
    };
  }
}

/**
 * The clone → scan → parse adapters used by ExecuteScanHandler.
 * Placeholders fail every job with a non-retryable error until the real adapters from
 * @code-guardian/infrastructure replace these providers.
 */
@Global()
@Module({
  providers: [
    {
      provide: WORKSPACE_PROVIDER,
      useFactory: (config: ConfigService<WorkerEnv, true>) =>
        new PlaceholderWorkspaceProvider(config.get('SCAN_WORK_DIR', { infer: true })),
      inject: [ConfigService],
    },
    { provide: REPOSITORY_CLONER, useFactory: () => new PlaceholderCloner() },
    { provide: SECURITY_SCANNER, useFactory: () => new PlaceholderScanner() },
    { provide: REPORT_PARSER, useFactory: () => new PlaceholderReportParser() },
  ],
  exports: [WORKSPACE_PROVIDER, REPOSITORY_CLONER, SECURITY_SCANNER, REPORT_PARSER],
})
export class ScanPipelineModule {}
