import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { type ApiEnv } from './config/env.schema';

/** Process-level HTTP setup shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<ApiEnv, true>>(ConfigService);
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }) });
  app.enableShutdownHooks();
}
