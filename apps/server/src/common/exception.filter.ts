import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '@andishkadeh/shared';
import type { Request, Response } from 'express';
import { ApiError } from './errors';

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
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message);
      code =
        status === 404
          ? ErrorCode.NOT_FOUND
          : status === 401
            ? ErrorCode.UNAUTHENTICATED
            : status === 403
              ? ErrorCode.FORBIDDEN
              : status === 413
                ? ErrorCode.VALIDATION_FAILED
                : ErrorCode.INTERNAL;
    }

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${req.method} ${req.url}: ${(exception as Error)?.stack ?? exception}`);
    }

    res.status(status).json({ error: { code, message, details }, requestId });
  }
}
