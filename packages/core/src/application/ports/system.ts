export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/** Minimal structured logger so the core does not depend on a logging framework. */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
