import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { LoggerModule } from 'nestjs-pino';
import { PersistenceModule } from './adapters/persistence.module';
import { ScanPipelineModule } from './adapters/scan-pipeline.module';
import { SystemModule } from './adapters/system.module';
import { validateWorkerEnv, type WorkerEnv } from './config/env.schema';
import { ScanWorkerModule } from './scan/scan-worker.module';

/** Root of the worker process: config, logging, Redis connection, CQRS, adapters, consumer. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateWorkerEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        pinoHttp: { level: config.get('LOG_LEVEL', { infer: true }) },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        // Workers block on Redis; ioredis must not give up on long-running commands.
        connection: { url: config.get('REDIS_URL', { infer: true }), maxRetriesPerRequest: null },
      }),
    }),
    CqrsModule.forRoot(),
    PersistenceModule,
    SystemModule,
    ScanPipelineModule,
    ScanWorkerModule,
  ],
})
export class WorkerModule {}
