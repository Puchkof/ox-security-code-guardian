import { randomUUID } from 'node:crypto';
import { type Clock, type IdGenerator } from '@code-guardian/core';
import { Global, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PinoCoreLogger } from '../shared/pino-core-logger';
import { CLOCK, ID_GENERATOR, LOGGER } from '../shared/port.tokens';

/**
 * Clock, id generator and logger ports.
 * TODO(infrastructure): swap the inline clock/ids for SystemClock and UuidIdGenerator.
 */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useFactory: (): Clock => ({ now: () => new Date() }) },
    { provide: ID_GENERATOR, useFactory: (): IdGenerator => ({ next: () => randomUUID() }) },
    {
      provide: LOGGER,
      useFactory: (pino: PinoLogger) => new PinoCoreLogger(pino),
      inject: [PinoLogger],
    },
  ],
  exports: [CLOCK, ID_GENERATOR, LOGGER],
})
export class SystemModule {}
