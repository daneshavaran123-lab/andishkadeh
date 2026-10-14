import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@andishkadeh/shared';

/** Structured API error → { error: { code, message, details }, requestId } */
export class ApiError extends HttpException {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what = 'مورد درخواستی') {
    return new ApiError(ErrorCode.NOT_FOUND, `${what} یافت نشد`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'دسترسی به این عملیات مجاز نیست') {
    return new ApiError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthenticated(message = 'نیاز به ورود مجدد') {
    return new ApiError(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }

  static conflict(code: ErrorCode | string, message: string, details?: unknown) {
    return new ApiError(code, message, HttpStatus.CONFLICT, details);
  }
}
