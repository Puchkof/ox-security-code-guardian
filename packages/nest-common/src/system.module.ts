import { SystemClock, UuidIdGenerator } from '@code-guardian/infrastructure';
import { Global, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PinoCoreLogger } from './pino-core-logger';
import { CLOCK, ID_GENERATOR, LOGGER } from './port.tokens';

/** Clock, id generator and logger ports. The logger needs nestjs-pino's LoggerModule at the root. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useFactory: () => new SystemClock() },
    { provide: ID_GENERATOR, useFactory: () => new UuidIdGenerator() },
    {
      provide: LOGGER,
      useFactory: (pino: PinoLogger) => new PinoCoreLogger(pino),
      inject: [PinoLogger],
    },
  ],
  exports: [CLOCK, ID_GENERATOR, LOGGER],
})
export class SystemModule {}
