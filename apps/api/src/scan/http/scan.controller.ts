import {
  GetScanQuery,
  StartScanCommand,
  type ScanView,
  type StartScanResult,
} from '@code-guardian/core';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { toScanResponse, type ScanResponse } from './scan.presenter';
import {
  getScanQuerySchema,
  scanIdSchema,
  startScanBodySchema,
  type GetScanQueryParams,
  type StartScanBody,
} from './scan.schemas';

/** REST transport. Only validates input, dispatches to the buses and shapes the output. */
@Controller('api/scan')
export class ScanController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @Body(new ZodValidationPipe(startScanBodySchema)) body: StartScanBody,
  ): Promise<StartScanResult> {
    return this.commandBus.execute<StartScanCommand, StartScanResult>(
      new StartScanCommand(body.repoUrl),
    );
  }

  @Get(':scanId')
  async get(
    @Param('scanId', new ZodValidationPipe(scanIdSchema)) scanId: string,
    @Query(new ZodValidationPipe(getScanQuerySchema)) query: GetScanQueryParams,
  ): Promise<ScanResponse> {
    const view = await this.queryBus.execute<GetScanQuery, ScanView>(
      new GetScanQuery(scanId, query.limit, query.cursor ?? null),
    );
    return toScanResponse(view);
  }
}
