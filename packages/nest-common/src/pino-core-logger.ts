import { type Logger } from '@code-guardian/core';
import { type PinoLogger } from 'nestjs-pino';

/** Implements the core Logger port on top of the app's pino instance. */
export class PinoCoreLogger implements Logger {
  constructor(private readonly pino: PinoLogger) {}

  info(message: string, context: Record<string, unknown> = {}): void {
    this.pino.info(context, message);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.pino.warn(context, message);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.pino.error(context, message);
  }
}
