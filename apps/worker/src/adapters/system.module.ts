import { type Clock } from '@code-guardian/core';
import { Global, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PinoCoreLogger } from '../shared/pino-core-logger';
import { CLOCK, LOGGER } from '../shared/port.tokens';

/**
 * Clock and logger ports.
 * TODO(infrastructure): swap the inline clock for SystemClock.
 */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useFactory: (): Clock => ({ now: () => new Date() }) },
    {
      provide: LOGGER,
      useFactory: (pino: PinoLogger) => new PinoCoreLogger(pino),
      inject: [PinoLogger],
    },
  ],
  exports: [CLOCK, LOGGER],
})
export class SystemModule {}
