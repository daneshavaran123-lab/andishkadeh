import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '@andishkadeh/shared';
import type { Request, Response } from 'express';
import { ApiError } from './errors';

/** Code and Persian message for errors that carry only an HTTP status (framework / middleware errors). */
const STATUS_ERRORS: Record<number, [ErrorCode, string]> = {
  400: [ErrorCode.VALIDATION_FAILED, 'درخواست نامعتبر است؛ بدنه درخواست قابل خواندن نیست'],
  401: [ErrorCode.UNAUTHENTICATED, 'نیاز به ورود مجدد'],
  403: [ErrorCode.FORBIDDEN, 'دسترسی به این مسیر مجاز نیست'],
  404: [ErrorCode.NOT_FOUND, 'مورد درخواستی یافت نشد'],
  413: [ErrorCode.VALIDATION_FAILED, 'حجم درخواست بیش از حد مجاز است'],
  415: [ErrorCode.VALIDATION_FAILED, 'نوع محتوای درخواست پشتیبانی نمی‌شود'],
};

/**
 * Errors raised by Express middleware (express.static, the JSON body parser) are http-errors
 * objects: they carry their 4xx status but are not Nest HttpExceptions.
 */
function clientErrorStatus(e: unknown): number | null {
  if (typeof e !== 'object' || e === null) return null;
  const status = (e as { status?: unknown; statusCode?: unknown }).status ?? (e as { statusCode?: unknown }).statusCode;
  return Number.isInteger(status) && (status as number) >= 400 && (status as number) < 500 ? (status as number) : null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL;
    let message = 'خطای داخلی سرور';
    let details: unknown;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      code = ErrorCode.CONFLICT;
      message = 'رکورد تکراری است';
      details = { target: exception.meta?.target };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      code = ErrorCode.NOT_FOUND;
      message = 'مورد درخواستی یافت نشد';
    } else if (exception instanceof HttpException || clientErrorStatus(exception) !== null) {
      // Framework and middleware errors: keep the status, never echo their English internals.
      status = exception instanceof HttpException ? exception.getStatus() : clientErrorStatus(exception)!;
      const known = STATUS_ERRORS[status];
      if (known) [code, message] = known;
      else if (status < 500) [code, message] = [ErrorCode.VALIDATION_FAILED, 'درخواست نامعتبر است'];
    }

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${req.method} ${req.url}: ${(exception as Error)?.stack ?? exception}`);
    }

    res.status(status).json({ error: { code, message, details }, requestId });
  }
}
