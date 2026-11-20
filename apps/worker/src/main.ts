import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Standalone application context: no HTTP server, only the BullMQ consumer.
 * On SIGTERM/SIGINT the shutdown hooks close the worker, which waits for the active job.
 */
async function bootstrap(): Promise<void> {
  // Nest declares its options bag as a class; a plain literal is the documented usage.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Scan worker started', 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
