// SSRF: เบราว์เซอร์ที่ runner เปิดต้องไม่เข้าถึงเครือข่ายภายใน
import net, { BlockList, isIP } from 'node:net';
import http from 'node:http';
import { lookup } from 'node:dns/promises';

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local รวม cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

const isPrivateIp = (ip: string) => PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
/** หน้าทดสอบของระบบเองที่อนุญาตให้เปิด (นอกนั้นของ server เดียวกันห้ามเข้า เช่น /api) */
export const DEMO_PATH = /^\/demo-[\w-]+\.html$/;

export type UrlVerdict = { ok: true; address: string } | { ok: false; reason: string };
export interface UrlGuard {
  check(rawUrl: string): Promise<UrlVerdict>;
}

export interface UrlGuardOptions {
  /** พอร์ตของระบบเอง (เพื่ออนุญาตเฉพาะหน้า demo) */
  appPort: number;
  /**
   * ALLOWED_HOSTS=example.com,*.staging.example.com  เปิดได้เฉพาะโดเมนเหล่านี้ (รวมโดเมนภายในที่ระบุชัด)
   * ALLOW_PRIVATE_NETWORK=true                       ปิดการกันเครือข่ายภายใน (ใช้คนเดียวบนเครื่องตัวเอง)
   */
  env?: Record<string, string | undefined>;
}

export function createUrlGuard({ appPort, env = process.env }: UrlGuardOptions): UrlGuard {
  const allowPrivate = env.ALLOW_PRIVATE_NETWORK === 'true';
  const allowed = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const matchesAllowlist = (host: string) =>
    allowed.some((p) => (p.startsWith('*.') ? host.endsWith(p.slice(1)) || host === p.slice(2) : host === p));

  const dnsCache = new Map<string, { ips: string[]; expires: number }>();
  async function resolve(host: string): Promise<string[]> {
    const hit = dnsCache.get(host);
    if (hit && hit.expires > Date.now()) return hit.ips;
    const ips = (await lookup(host, { all: true })).map((a) => a.address);
    dnsCache.set(host, { ips, expires: Date.now() + 60_000 });
    return ips;
  }

  // address = IP ที่ตรวจแล้ว ให้ proxy เชื่อมต่อไปที่ IP นี้ตรงๆ (กัน DNS rebinding ระหว่างตรวจกับเชื่อมต่อ)
  const allow = (address: string): UrlVerdict => ({ ok: true, address });
  const deny = (reason: string): UrlVerdict => ({ ok: false, reason });
  const PRIVATE_HINT = 'ถ้าต้องการทดสอบเว็บภายใน ให้ตั้ง ALLOWED_HOSTS ใน .env';

  async function check(rawUrl: string): Promise<UrlVerdict> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return deny('URL ไม่ถูกต้อง');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return deny('เปิดได้เฉพาะ URL แบบ http หรือ https');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');

    // หน้า demo ของระบบเอง (HTTPS ผ่าน CONNECT ไม่เห็น path จึงตรวจเฉพาะ http)
    if (LOOPBACK_NAMES.has(host) && port === String(appPort)) {
      return url.protocol === 'http:' && DEMO_PATH.test(url.pathname) ? allow(host) : deny('เปิดได้เฉพาะหน้า demo ของระบบนี้');
    }
    if (allowed.length) return matchesAllowlist(host) ? allow(host) : deny(`โดเมน ${host} ไม่อยู่ใน ALLOWED_HOSTS`);
    if (allowPrivate) return allow(host);
    if (host === 'localhost' || host.endsWith('.localhost')) return deny(`ไม่อนุญาตให้เปิดที่อยู่ภายในเครื่อง — ${PRIVATE_HINT}`);

    let ips: string[];
    try {
      ips = isIP(host) ? [host] : await resolve(host);
    } catch {
      return deny(`หาโดเมน ${host} ไม่เจอ`);
    }
    if (ips.some(isPrivateIp)) return deny(`ไม่อนุญาตให้เปิดที่อยู่ภายในเครือข่าย (${host}) — ${PRIVATE_HINT}`);
    return allow(ips[0]!);
  }

  return { check };
}

export interface GuardProxy {
  /** ส่งให้ chromium.launch: บังคับให้ localhost ผ่าน proxy ด้วย (ปกติ Chromium ข้าม proxy สำหรับ loopback) */
  launchOptions: { proxy: { server: string; bypass: string } };
  close(): void;
}

/**
 * HTTP proxy ที่เบราว์เซอร์ทุก request ต้องผ่าน (รวม redirect ทุก hop และ WebSocket)
 * ใช้แทน page.route เพราะ route ไม่ถูกเรียกกับ redirect ทำให้ redirect ไปที่อยู่ภายในหลุดได้
 */
export async function startGuardProxy(guard: UrlGuard): Promise<GuardProxy> {
  const blockedPage = (reason: string) =>
    `<!doctype html><meta charset="utf-8"><title>ถูกบล็อก</title><body style="font-family:system-ui;padding:40px">` +
    `<h2>Test Studio บล็อกการเข้าถึงนี้</h2><p>${reason.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</p></body>`;

  const server = http.createServer(async (req, res) => {
    // proxy request แบบ http: req.url เป็น URL เต็ม
    const verdict = await guard.check(req.url ?? '');
    if (!verdict.ok) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return void res.end(blockedPage(verdict.reason));
    }
    const target = new URL(req.url!);
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const upstream = http.request(
      { host: verdict.address, port: target.port || 80, method: req.method, path: target.pathname + target.search, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.rawHeaders);
        up.pipe(res);
      }
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // https และ websocket แบบเข้ารหัส: ตรวจปลายทางตอน CONNECT แล้วต่อท่อไปที่ IP ที่ตรวจแล้ว
  server.on('connect', async (req, client, head) => {
    const m = (req.url ?? '').match(/^\[?([^\]]+?)\]?:(\d+)$/);
    const verdict: UrlVerdict = m
      ? await guard.check(`https://${m[1]!.includes(':') ? `[${m[1]}]` : m[1]}:${m[2]}/`)
      : { ok: false, reason: 'ปลายทางไม่ถูกต้อง' };
    if (!verdict.ok || !m) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect(Number(m[2]), verdict.address, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    launchOptions: { proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' } },
    close: () => void server.close(),
  };
}
