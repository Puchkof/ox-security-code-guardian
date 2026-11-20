import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { type ApiEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // Nest declares its options bag as a class; a plain literal is the documented usage.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const config = app.get<ConfigService<ApiEnv, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}

bootstrap().catch((error: unknown) => {
  console.error('API failed to start', error);
  process.exit(1);
});
