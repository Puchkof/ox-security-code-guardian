import { Inject, type Type } from '@nestjs/common';
import { CommandHandler, QueryHandler } from '@nestjs/cqrs';

/** Shape shared by every core handler: one message in, one result out. */
export interface UseCase<TMessage, TResult> {
  execute(message: TMessage): Promise<TResult>;
}

/**
 * Registers a plain core handler on the Nest CommandBus without the core knowing about Nest.
 * The core handler itself must be provided under its own class as token (usually via a
 * factory provider that injects the ports).
 */
export function bindCommandHandler<TCommand extends object, TResult>(
  command: Type<TCommand>,
  useCase: Type<UseCase<TCommand, TResult>>,
): Type<UseCase<TCommand, TResult>> {
  @CommandHandler(command)
  class CoreCommandHandlerAdapter implements UseCase<TCommand, TResult> {
    constructor(@Inject(useCase) private readonly inner: UseCase<TCommand, TResult>) {}

    execute(message: TCommand): Promise<TResult> {
      return this.inner.execute(message);
    }
  }
  Object.defineProperty(CoreCommandHandlerAdapter, 'name', { value: `${useCase.name}CqrsAdapter` });
  return CoreCommandHandlerAdapter;
}

/** QueryBus counterpart of {@link bindCommandHandler}. */
export function bindQueryHandler<TQuery extends object, TResult>(
  query: Type<TQuery>,
  useCase: Type<UseCase<TQuery, TResult>>,
): Type<UseCase<TQuery, TResult>> {
  @QueryHandler(query)
  class CoreQueryHandlerAdapter implements UseCase<TQuery, TResult> {
    constructor(@Inject(useCase) private readonly inner: UseCase<TQuery, TResult>) {}

    execute(message: TQuery): Promise<TResult> {
      return this.inner.execute(message);
    }
  }
  Object.defineProperty(CoreQueryHandlerAdapter, 'name', { value: `${useCase.name}CqrsAdapter` });
  return CoreQueryHandlerAdapter;
}
