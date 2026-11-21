import { type PipeTransform } from '@nestjs/common';
import { type z } from 'zod';
import { RequestValidationError } from './request-validation.error';

/** Validates and narrows a request part (body, params, query) with a zod schema. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new RequestValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.map(String).join('.');
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      }),
    );
  }
}
