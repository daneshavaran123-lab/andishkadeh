import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

  // One origin, three parts (docs/server-setup.md):
  //   /        customer web app (apps/kiosk dist-web)
  //   /admin   admin panel (apps/admin dist)
  //   /kiosk   kiosk management: the same panel build, which shows only its kiosk pages there
  // Client-side routes fall back to their index.html; a missing asset stays a 404.
  const isFile = (path: string) => /\.[a-z0-9]+$/i.test(path);
  const isPage = (req: express.Request) => (req.method === 'GET' || req.method === 'HEAD') && !isFile(req.path);
  if (cfg.adminDistAbs && existsSync(join(cfg.adminDistAbs, 'index.html'))) {
    const index = join(cfg.adminDistAbs, 'index.html');
    const panelPage = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!isPage(req)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    };
    app.use('/admin', express.static(cfg.adminDistAbs, { index: false, maxAge: '1h', dotfiles: 'deny' }));
    app.use('/admin', panelPage);
    app.use('/kiosk', panelPage);
  }

  // Customer web app at the root. Hashed assets are immutable; the entry page, manifest and service
  // worker are revalidated so a new release reaches every browser on its next start.
  if (cfg.webAppDistAbs && existsSync(join(cfg.webAppDistAbs, 'index.html'))) {
    const webDist = cfg.webAppDistAbs;
    const webIndex = join(webDist, 'index.html');
    const ownPath = (req: express.Request) => !/^\/(api|admin|kiosk)(\/|$)/.test(req.path);
    const files = express.static(webDist, {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res, path) => {
        // Judged from inside the dist folder: a deployment path containing "assets" must not make
        // index.html or sw.js immutable (browsers would never update).
        const rel = relative(webDist, path).split(sep).join('/');
        if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    });
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => (ownPath(req) ? files(req, res, next) : next()));
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!ownPath(req) || !isPage(req)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(webIndex);
    });
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  setupOpenApi(app);
  await app.init();
  return app;
}
