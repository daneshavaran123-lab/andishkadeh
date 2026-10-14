import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { requestIdMiddleware, securityHeadersMiddleware } from './common/request-id.middleware';
import { config } from './config';
import { setupOpenApi } from './openapi/openapi';

/** Shared by main.ts and integration tests so both run the exact same HTTP pipeline. */
export async function createApp(opts: { logger?: boolean } = {}) {
  const cfg = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
    bodyParser: false,
  });
  if (cfg.TRUST_PROXY) app.set('trust proxy', cfg.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '2mb' }));

  app.enableCors({
    origin: cfg.corsOrigins.length ? cfg.corsOrigins : false,
    credentials: false,
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
  });

  // Content-addressed media: safe to cache forever, kiosks verify the sha256 after download.
  mkdirSync(cfg.mediaDirAbs, { recursive: true });
  app.use(
    '/api/v1/media/files',
    express.static(cfg.mediaDirAbs, { immutable: true, maxAge: '365d', index: false, dotfiles: 'deny', fallthrough: false }),
  );

  // Single-origin deployment: the built admin SPA under /admin (client-side routes fall back to index.html).
  if (cfg.adminDistAbs && existsSync(join(cfg.adminDistAbs, 'index.html'))) {
    const index = join(cfg.adminDistAbs, 'index.html');
    app.use('/admin', express.static(cfg.adminDistAbs, { index: false, maxAge: '1h', dotfiles: 'deny' }));
    app.use('/admin', (req: express.Request, res: express.Response, next: express.NextFunction) => {
      // Only client-side routes fall back to the SPA; a missing asset stays a 404.
      if (req.method !== 'GET' || /\.[a-z0-9]+$/i.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  setupOpenApi(app);
  await app.init();
  return app;
}
