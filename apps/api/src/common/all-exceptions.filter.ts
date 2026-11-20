import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { type GqlContextType, type GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { describeError, type ErrorResponseBody } from './error-mapping';

/**
 * Global filter for both transports.
 * REST: replies `{ error: { code, message } }` with the mapped status.
 * GraphQL: returns a GraphQLError carrying the same code and status in `extensions`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter, GqlExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): GraphQLError | undefined {
    const descriptor = describeError(exception);
    if (descriptor.status >= 500) {
      this.logger.error(
        { err: exception, code: descriptor.code },
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    if (host.getType<GqlContextType>() === 'graphql') {
      return new GraphQLError(descriptor.message, {
        extensions: { code: descriptor.code, status: descriptor.status },
      });
    }

    const body: ErrorResponseBody = {
      error: { code: descriptor.code, message: descriptor.message },
    };
    const { httpAdapter } = this.adapterHost;
    httpAdapter.reply(host.switchToHttp().getResponse(), body, descriptor.status);
    return undefined;
  }
}
