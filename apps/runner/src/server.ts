// ชั้น WebSocket ของ runner: ตรวจสิทธิ์ตอนเชื่อมต่อ จำกัดจำนวน session และเปิดเบราว์เซอร์ที่มี proxy กัน SSRF
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createUrlGuard, startGuardProxy, verifyRunnerToken, type ServerMessage } from '@test-studio/core';
import type { Store } from '@test-studio/db';
import { chromium, type Browser } from 'playwright';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RunnerConfig } from './config.js';
import { Session } from './session.js';
import { startWorker, type Worker, type WorkerOptions } from './worker.js';

const LOOPBACK_HOSTS = (port: number) => new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
/** ถ้าผู้ใช้เชื่อมช้าจนข้อมูลค้างเกินนี้ จะทิ้งเฟรมภาพ (ไม่ทิ้งข้อความอื่น) กันหน่วยความจำบวม */
const MAX_BUFFERED_BYTES = 2_000_000;

export interface RunnerOptions {
  store: Store;
  config: RunnerConfig;
  /** ค่าตั้งของ URL guard (ALLOWED_HOSTS, ALLOW_PRIVATE_NETWORK) ค่าเริ่มต้น = process.env */
  guardEnv?: Record<string, string | undefined>;
  /** ตัวส่งแจ้งเตือนของ worker (เทสใช้ตัวปลอม) */
  notify?: WorkerOptions['notify'];
}

export interface Runner {
  /** ผูกกับ event 'upgrade' ของ http server: server.on('upgrade', runner.handleUpgrade) */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  readonly sessionCount: number;
  /** worker รันอัตโนมัติ (null = ปิดด้วย WORKER=false) */
  readonly worker: Worker | null;
  close(): Promise<void>;
}

export type UpgradeVerdict = { ok: true; user?: string } | { ok: false; status: number; reason: string };

/**
 * ตัดสินว่าอนุญาตให้เชื่อม WebSocket หรือไม่ (แยกออกมาเพื่อทดสอบได้โดยไม่ต้องเปิดเบราว์เซอร์)
 * - Origin ต้องมาจากเว็บของเรา (กัน Cross-Site WebSocket Hijacking)
 * - มี RUNNER_TOKEN_SECRET: ต้องมี token ที่ถูกต้องและไม่หมดอายุ
 * - ไม่มี: ต้องเป็นเครื่องตัวเองเท่านั้น (ตรวจ Host กัน DNS rebinding)
 */
export function authorizeUpgrade(req: IncomingMessage, config: RunnerConfig, sessionCount: number): UpgradeVerdict {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return { ok: false, status: 404, reason: 'Not Found' };

  const host = String(req.headers.host ?? '').toLowerCase();
  const origin = req.headers.origin;
  if (!origin) return { ok: false, status: 403, reason: 'Missing Origin' };
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return { ok: false, status: 403, reason: 'Invalid Origin' };
  }
  if (config.allowedOrigins.length) {
    if (!config.allowedOrigins.some((o) => o.toLowerCase().replace(/\/$/, '') === origin.toLowerCase())) return { ok: false, status: 403, reason: 'Origin not allowed' };
  } else if (originHost !== host) {
    return { ok: false, status: 403, reason: 'Invalid Origin' };
  }

  let user: string | undefined;
  if (config.tokenSecret) {
    const claims = verifyRunnerToken(config.tokenSecret, url.searchParams.get('token'));
    if (!claims) return { ok: false, status: 401, reason: 'Unauthorized' };
    user = claims.sub;
  } else if (!LOOPBACK_HOSTS(config.port).has(host)) {
    return { ok: false, status: 403, reason: 'Invalid Host header' };
  }

  if (sessionCount >= config.maxSessions) return { ok: false, status: 503, reason: 'Too many sessions' };
  return { ok: true, user };
}

export async function createRunner(options: RunnerOptions): Promise<Runner> {
  const { store, config, guardEnv = process.env } = options;
  // ทุก request ของเบราว์เซอร์ผ่าน proxy ที่กันการเข้าถึงเครือข่ายภายใน (SSRF)
  const urlGuard = createUrlGuard({ appPort: config.appPort, env: guardEnv });
  const guardProxy = await startGuardProxy(urlGuard);
  // --disable-dev-shm-usage: /dev/shm ใน container มักเล็กเกินไปจน Chromium ล่ม
  // WebRTC ส่ง UDP ตรงโดยไม่ผ่าน proxy (STUN/ICE ไปที่อยู่ภายในได้) จึงบังคับให้ใช้เฉพาะเส้นทางที่ผ่าน proxy
  const args = ['--disable-dev-shm-usage', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
  const browser: Browser = await chromium.launch({ headless: true, args, ...guardProxy.launchOptions });

  const worker = config.worker.enabled ? startWorker({ store, browser, urlGuard, pollMs: config.worker.pollMs, publicAppUrl: config.worker.publicAppUrl, notify: options.notify }) : null;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const sessions = new Set<Session>();

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user?: string) => {
    const send = (message: ServerMessage) => {
      if (ws.readyState !== ws.OPEN) return;
      if (message.type === 'frame' && ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
      ws.send(JSON.stringify(message));
    };
    const session = new Session({ store, browser, urlGuard, user, send, isOpen: () => ws.readyState === ws.OPEN });
    sessions.add(session);
    session.start();
    ws.on('message', (raw, isBinary) => {
      if (!isBinary) session.receive(raw.toString());
    });
    ws.on('close', () => {
      sessions.delete(session);
      void session.dispose();
    });
    ws.on('error', () => ws.close());
  });

  const reject = (socket: Duplex, status: number, reason: string) => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  return {
    handleUpgrade(req, socket, head) {
      const verdict = authorizeUpgrade(req, config, sessions.size);
      if (!verdict.ok) return reject(socket, verdict.status, verdict.reason);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, verdict.user));
    },
    get sessionCount() {
      return sessions.size;
    },
    worker,
    async close() {
      await worker?.stop();
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      await Promise.allSettled([...sessions].map((s) => s.dispose()));
      await browser.close().catch(() => {});
      guardProxy.close();
      wss.close();
    },
  };
}
