import { randomUUID } from 'node:crypto';
import { type IdGenerator } from '@code-guardian/core';

/** RFC 4122 v4 ids; they match the `uuid` column type of the scans table. */
export class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
