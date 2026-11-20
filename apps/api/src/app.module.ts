import { PersistenceModule, SystemModule } from '@code-guardian/nest-common';
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { LoggerModule } from 'nestjs-pino';
import { QueueModule } from './adapters/queue.module';
import { ApiModule } from './api.module';
import { validateApiEnv, type ApiEnv } from './config/env.schema';

export interface AppModuleOptions {
  /**
   * `infrastructure` (default): PostgreSQL + Redis/BullMQ.
   * `in-memory`: process-local fakes, no external services (tests and quick demos only).
   */
  readonly adapters?: 'infrastructure' | 'in-memory';
}

/**
 * Root of the API process: config, logging, CQRS buses, port adapters and the API surface.
 * A `forRoot()` factory rather than static metadata, so importing this file has no side
 * effects: env is loaded and validated only when an app is actually created from it.
 */
@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    const inMemory = options.adapters === 'in-memory';
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateApiEnv }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<ApiEnv, true>) => ({
            pinoHttp: {
              level: config.get('LOG_LEVEL', { infer: true }),
              redact: ['req.headers.authorization', 'req.headers.cookie'],
            },
          }),
        }),
        CqrsModule.forRoot(),
        inMemory ? PersistenceModule.inMemory() : PersistenceModule.prisma(),
        inMemory ? QueueModule.inMemory() : QueueModule.bullmq(),
        SystemModule,
        ApiModule,
      ],
    };
  }
}
