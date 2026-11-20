import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { HealthModule } from './health/health.module';
import { ScanModule } from './scan/scan.module';

/**
 * The API surface (REST, GraphQL, health, error mapping) without any process-level wiring.
 * It expects the root to provide config, logging, CqrsModule.forRoot() and the port adapters,
 * so a single-process entrypoint can import it next to the worker module.
 */
@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      path: '/graphql',
      autoSchemaFile: true,
      sortSchema: true,
      playground: false,
      includeStacktraceInErrorResponses: false,
    }),
    ScanModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class ApiModule {}
