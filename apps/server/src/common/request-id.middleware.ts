import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Propagates X-Request-Id (or creates one) so kiosk logs, server logs and errors correlate. */
export function requestIdMiddleware(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id') ?? req.header('x-correlation-id');
  const id = incoming && /^[A-Za-z0-9._-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** Conservative security headers for a JSON API (no helmet dependency needed). */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  next();
}
