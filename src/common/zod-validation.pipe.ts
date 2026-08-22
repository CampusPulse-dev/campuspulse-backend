import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates with the schema straight out of src/contract, so the
 * runtime check and the frontend's compile-time type are the same object.
 * ZodError is translated by AllExceptionsFilter.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
