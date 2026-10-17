/**
 * Development / E2E bridge: runs the real KioskCore in Node and exposes the same IPC channels
 * over HTTP (POST /ipc/:channel) plus Server-Sent Events (GET /events), so the kiosk UI can be
 * developed and tested in a normal browser. Not part of the production Electron build.
 */
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel } from '../core/types';
import { createNodeCore, loadConfig } from '../platform/node';

const PORT = Number(process.env.KIOSK_BRIDGE_PORT ?? 5175);
// The bridge can start payments: only this machine may reach it.
const HOST = process.env.KIOSK_BRIDGE_HOST ?? 'localhost';
const dataDir = resolve(process.env.KIOSK_DATA_DIR ?? resolve(__dirname, '../../.kiosk-data'));
const allowedOrigins = (process.env.KIOSK_BRIDGE_ORIGINS ?? 'http://localhost:5174,http://127.0.0.1:5174').split(',');

const cfg = loadConfig(dataDir, {
  deviceKey: process.env.KIOSK_DEVICE_KEY ?? 'dev-kiosk-key-0123456789',
  devControls: process.env.KIOSK_DEV_CONTROLS !== '0',
  kioskMode: false,
  intervals: {
    heartbeatSec: Number(process.env.KIOSK_HEARTBEAT_SEC ?? 15),
    pullSec: Number(process.env.KIOSK_PULL_SEC ?? 20),
    pushSec: Number(process.env.KIOSK_PUSH_SEC ?? 5),
    recoverySec: Number(process.env.KIOSK_RECOVERY_SEC ?? 30),
  },
});

const core = createNodeCore(cfg, { mediaBase: `http://localhost:${PORT}/media` });
core.start();

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/ipc/')) {
      // JSON only: a cross-site form post cannot send it without a CORS preflight we refuse.
      const origin = req.headers.origin;
      if ((origin && !allowedOrigins.includes(origin)) || !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      const channel = decodeURIComponent(url.pathname.slice(5)) as IpcChannel;
      if (!IPC_CHANNELS.includes(channel)) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'channel not allowed' }));
        return;
      }
      const out = await core.handle(channel, (await readJson(req)) as never);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out ?? null));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      const offs = IPC_EVENTS.map((ev) => core.on(ev, (data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)));
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        offs.forEach((o) => o());
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const checksum = url.pathname.slice(7).replace(/[^a-f0-9]/g, '');
      const file = core.catalog.mediaPath(checksum);
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
      createReadStream(file.path).pipe(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(core.statusSync()));
      return;
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
  }
}

const server = createServer((req, res) => void handle(req, res));

server.listen(PORT, HOST, () => {
  console.log(`[kiosk-bridge] core running, device=${cfg.deviceId} server=${cfg.serverUrl} data=${dataDir} → http://${HOST}:${PORT}`);
});

const shutdown = () => {
  core.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
