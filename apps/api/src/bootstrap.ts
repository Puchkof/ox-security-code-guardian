import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module';
import { type ApiEnv } from './config/env.schema';

export interface ApiBootstrapOptions extends AppModuleOptions {
  /** Port to listen on; overrides PORT. `0` picks a free port. */
  readonly port?: number;
  /**
   * Install SIGTERM/SIGINT handlers that close this app (Nest shutdown hooks). Default true.
   * Pass false when the caller owns signal handling, e.g. a single process running API + worker:
   * Nest re-raises the signal after closing one app, which would cut the other app's shutdown short.
   */
  readonly handleSignals?: boolean;
  /**
   * Route Nest's global logger through this app's pino instance. Default true.
   * Nest's logger override is process-global, so in a shared process exactly one app should do it.
   */
  readonly installGlobalLogger?: boolean;
}

/** HTTP setup shared by {@link bootstrapApi} and the e2e tests. */
export function configureApp(app: INestApplication, options: ApiBootstrapOptions = {}): void {
  const config = app.get<ConfigService<ApiEnv, true>>(ConfigService);
  if (options.installGlobalLogger ?? true) app.useLogger(app.get(Logger));
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }) });
  if (options.handleSignals ?? true) app.enableShutdownHooks();
}

/**
 * Creates, configures and starts the API. No side effects until called; safe to run in the
 * same process as `bootstrapWorker`. Rejects (without exiting the process) on startup failure.
 */
export async function bootstrapApi(options: ApiBootstrapOptions = {}): Promise<INestApplication> {
  const installGlobalLogger = options.installGlobalLogger ?? true;
  const rootModule = AppModule.forRoot({ adapters: options.adapters ?? 'infrastructure' });
  // Nest declares its options bag as a class; a plain literal is the documented usage.
  // Buffered logs are flushed by useLogger(); without it they would be held forever.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
  const app = await NestFactory.create(rootModule, { bufferLogs: installGlobalLogger });
  try {
    configureApp(app, options);
    const config = app.get<ConfigService<ApiEnv, true>>(ConfigService);
    await app.listen(options.port ?? config.get('PORT', { infer: true }));
    return app;
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}
