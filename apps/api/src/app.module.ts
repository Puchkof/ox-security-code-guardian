import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { LoggerModule } from 'nestjs-pino';
import { PersistenceModule } from './adapters/persistence.module';
import { QueueModule } from './adapters/queue.module';
import { SystemModule } from './adapters/system.module';
import { ApiModule } from './api.module';
import { validateApiEnv, type ApiEnv } from './config/env.schema';

/** Root of the API process: config, logging, CQRS buses, port adapters and the API surface. */
@Module({
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
    PersistenceModule,
    QueueModule,
    SystemModule,
    ApiModule,
  ],
})
export class AppModule {}
