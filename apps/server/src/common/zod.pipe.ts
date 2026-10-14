import { HttpStatus, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@andishkadeh/shared';
import type { ZodTypeAny, z } from 'zod';
import { ApiError } from './errors';

/** Validates and coerces a request part with a shared zod contract. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        result.error.issues[0]?.message ?? 'ورودی نامعتبر است',
        HttpStatus.BAD_REQUEST,
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}
