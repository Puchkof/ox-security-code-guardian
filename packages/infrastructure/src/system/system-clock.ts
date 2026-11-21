import { type Clock } from '@code-guardian/core';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
