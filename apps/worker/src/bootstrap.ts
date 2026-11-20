import { Logger as NestLogger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

export interface WorkerBootstrapOptions {
  /**
   * Install SIGTERM/SIGINT handlers that close the worker (Nest shutdown hooks). Default true.
   * Pass false when the caller owns signal handling, e.g. a single process running API + worker.
   * Closing the context closes the BullMQ worker, which waits for the active job.
   */
  readonly handleSignals?: boolean;
  /**
   * Route Nest's global logger through this app's pino instance. Default true.
   * Nest's logger override is process-global, so in a shared process exactly one app should do it.
   */
  readonly installGlobalLogger?: boolean;
}

/**
 * Creates the standalone worker context (no HTTP server) and starts consuming the 'scans'
 * queue. No side effects until called; safe to run in the same process as `bootstrapApi`.
 */
export async function bootstrapWorker(
  options: WorkerBootstrapOptions = {},
): Promise<INestApplicationContext> {
  const installGlobalLogger = options.installGlobalLogger ?? true;
  // Nest declares its options bag as a class; a plain literal is the documented usage.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(), {
    bufferLogs: installGlobalLogger,
  });
  if (installGlobalLogger) app.useLogger(app.get(Logger));
  if (options.handleSignals ?? true) app.enableShutdownHooks();
  new NestLogger('Bootstrap').log('Scan worker started');
  return app;
}
