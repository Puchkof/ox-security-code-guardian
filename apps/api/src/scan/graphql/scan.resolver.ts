import {
  GetScanQuery,
  StartScanCommand,
  type ScanView,
  type StartScanResult,
} from '@code-guardian/core';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ScanModel, StartScanPayload } from './scan.models';

/** GraphQL transport over the same buses as the REST controller. */
@Resolver(() => ScanModel)
export class ScanResolver {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Mutation(() => StartScanPayload)
  startScan(@Args('repoUrl', { type: () => String }) repoUrl: string): Promise<StartScanResult> {
    return this.commandBus.execute<StartScanCommand, StartScanResult>(
      new StartScanCommand(repoUrl),
    );
  }

  @Query(() => ScanModel, { name: 'scan', nullable: true })
  scan(
    @Args('id', { type: () => ID }) id: string,
    @Args('first', { type: () => Int, nullable: true }) first?: number | null,
    @Args('after', { type: () => String, nullable: true }) after?: string | null,
  ): Promise<ScanView> {
    return this.queryBus.execute<GetScanQuery, ScanView>(
      new GetScanQuery(id, first ?? undefined, after ?? null),
    );
  }
}
