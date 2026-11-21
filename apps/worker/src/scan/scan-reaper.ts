import { ReapStuckScansCommand, type Logger, type ReapStuckScansResult } from '@code-guardian/core';
import { LOGGER } from '@code-guardian/nest-common';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

export const REAPER_INTERVAL_MS = Symbol.for('code-guardian:ReaperIntervalMs');

/**
 * Runs ReapStuckScans periodically. Runs never overlap, and several workers reaping
 * at the same time are safe because every write is version-checked.
 */
@Injectable()
export class ScanReaper implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly commandBus: CommandBus,
    @Inject(REAPER_INTERVAL_MS) private readonly intervalMs: number,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.tick().finally(() => {
        this.running = undefined;
      });
    }, this.intervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Exposed for tests. */
  async tick(): Promise<void> {
    try {
      await this.commandBus.execute<ReapStuckScansCommand, ReapStuckScansResult>(
        new ReapStuckScansCommand(),
      );
    } catch (error: unknown) {
      this.logger.error('Reaper pass failed', { error });
    }
  }
}
