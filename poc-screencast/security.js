// ความปลอดภัยพื้นฐาน: กัน SSRF, เข้ารหัสตัวแปรลับ, ควบคุมการเข้าใช้งาน
import net, { BlockList, isIP } from 'node:net';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------- SSRF: เบราว์เซอร์ที่ server เปิดต้องไม่เข้าถึงเครือข่ายภายใน ----------

const PRIVATE = new BlockList();
for (const [net, prefix] of [
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
]) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

const isPrivateIp = (ip) => PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
// หน้าทดสอบของระบบเองที่อนุญาตให้เปิด (นอกนั้นของ server นี้ห้ามเข้า เช่น /api)
const DEMO_PATH = /^\/demo-[\w-]+\.html$/;

/**
 * ตัวตรวจ URL ตามค่าตั้ง:
 * - ALLOWED_HOSTS=example.com,*.staging.example.com  เปิดได้เฉพาะโดเมนเหล่านี้ (รวมโดเมนภายในที่ระบุชัด)
 * - ALLOW_PRIVATE_NETWORK=true                       ปิดการกันเครือข่ายภายใน (ใช้คนเดียวบนเครื่องตัวเอง)
 */
export function createUrlGuard({ appPort, env = process.env }) {
  const allowPrivate = env.ALLOW_PRIVATE_NETWORK === 'true';
  const allowed = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const matchesAllowlist = (host) =>
    allowed.some((p) => (p.startsWith('*.') ? host.endsWith(p.slice(1)) || host === p.slice(2) : host === p));

  const dnsCache = new Map(); // host -> { ips, expires }
  async function resolve(host) {
    const hit = dnsCache.get(host);
    if (hit && hit.expires > Date.now()) return hit.ips;
    const ips = (await lookup(host, { all: true })).map((a) => a.address);
    dnsCache.set(host, { ips, expires: Date.now() + 60_000 });
    return ips;
  }

  // address = IP ที่ตรวจแล้ว ให้ proxy เชื่อมต่อไปที่ IP นี้ตรงๆ (กัน DNS rebinding ระหว่างตรวจกับเชื่อมต่อ)
  const allow = (address) => ({ ok: true, address });
  const deny = (reason) => ({ ok: false, reason });
  const PRIVATE_HINT = 'ถ้าต้องการทดสอบเว็บภายใน ให้ตั้ง ALLOWED_HOSTS ใน .env';

  async function check(rawUrl) {
    let url;
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

    let ips;
    try {
      ips = isIP(host) ? [host] : await resolve(host);
    } catch {
      return deny(`หาโดเมน ${host} ไม่เจอ`);
    }
    if (ips.some(isPrivateIp)) return deny(`ไม่อนุญาตให้เปิดที่อยู่ภายในเครือข่าย (${host}) — ${PRIVATE_HINT}`);
    return allow(ips[0]);
  }

  return { check };
}

/**
 * HTTP proxy ที่เบราว์เซอร์ทุก request ต้องผ่าน (รวม redirect ทุก hop และ WebSocket)
 * ใช้แทน page.route เพราะ route ไม่ถูกเรียกกับ redirect ทำให้ redirect ไปที่อยู่ภายในหลุดได้
 */
export async function startGuardProxy(guard) {
  const blockedPage = (reason) =>
    `<!doctype html><meta charset="utf-8"><title>ถูกบล็อก</title><body style="font-family:system-ui;padding:40px">` +
    `<h2>Test Studio บล็อกการเข้าถึงนี้</h2><p>${reason.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</p></body>`;

  const server = http.createServer(async (req, res) => {
    // proxy request แบบ http: req.url เป็น URL เต็ม
    const verdict = await guard.check(req.url);
    if (!verdict.ok) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(blockedPage(verdict.reason));
    }
    const target = new URL(req.url);
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const upstream = http.request(
      {
        host: verdict.address,
        port: target.port || 80,
        method: req.method,
        path: target.pathname + target.search,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode, up.rawHeaders);
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
    const m = req.url.match(/^\[?([^\]]+?)\]?:(\d+)$/);
    const verdict = m ? await guard.check(`https://${m[1].includes(':') ? `[${m[1]}]` : m[1]}:${m[2]}/`) : { ok: false };
    if (!verdict.ok) {
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

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    // ส่งให้ chromium.launch: บังคับให้ localhost ผ่าน proxy ด้วย (ปกติ Chromium ข้าม proxy สำหรับ loopback)
    launchOptions: { proxy: { server: `http://127.0.0.1:${server.address().port}`, bypass: '<-loopback>' } },
    close: () => server.close(),
  };
}

// ---------- เข้ารหัสตัวแปรลับ (AES-256-GCM) ----------

const ENC_PREFIX = 'enc:v1:';

// key มาจาก SECRET_KEY ใน .env ถ้าไม่ได้ตั้ง จะสร้างไฟล์ data/secret.key ให้ (ควรย้ายไปเก็บที่อื่นเมื่อใช้จริง)
// dataDir = null (เช่น ฐานข้อมูลในหน่วยความจำ) ใช้ key ชั่วคราวที่ไม่เขียนลงไฟล์
function loadKey(dataDir) {
  if (process.env.SECRET_KEY) return crypto.createHash('sha256').update(process.env.SECRET_KEY).digest();
  if (!dataDir) return crypto.randomBytes(32);
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    console.warn(`[security] สร้าง key สำหรับเข้ารหัสตัวแปรลับที่ ${file} — เมื่อใช้งานจริงควรตั้ง SECRET_KEY ใน .env แทน`);
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
}

export function createCipher(dataDir) {
  const key = loadKey(dataDir);
  return {
    isEncrypted: (stored) => String(stored).startsWith(ENC_PREFIX),
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
      return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    decrypt(stored) {
      if (!String(stored).startsWith(ENC_PREFIX)) return stored; // ค่าเก่าก่อนมีการเข้ารหัส
      const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

// ---------- ควบคุมการเข้าใช้งาน ----------

const LOOPBACK_BIND = new Set(['127.0.0.1', 'localhost', '::1']);
export const isLoopbackBind = (host) => LOOPBACK_BIND.has(host);

/**
 * - Host header ต้องเป็นชื่อที่รู้จัก (กัน DNS rebinding)
 * - WebSocket ต้องมาจากหน้าเว็บของเราเอง (กัน Cross-Site WebSocket Hijacking)
 * - ถ้าตั้ง APP_PASSWORD ต้องล็อกอินก่อน
 */
export function createAccessControl({ port, env = process.env }) {
  const password = env.APP_PASSWORD || null;
  // PUBLIC_HOSTS: ชื่อที่ใช้เปิดระบบจากภายนอก เช่น test-studio.lan:3000 หรือ *.vercel.app (ไม่มีพอร์ต = ตรงกับ Host ที่ไม่มีพอร์ต)
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  hosts.push(...(env.PUBLIC_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  const SESSION_MS = 12 * 60 * 60 * 1000;
  const failures = new Map(); // ip -> [timestamps]
  const COOKIE = 'ts_session';
  // session เป็น cookie ที่เซ็นด้วย HMAC (ไม่เก็บในหน่วยความจำ) ใช้ได้แม้ request ไปคนละ instance เช่นบน Vercel
  // key ผูกกับ APP_PASSWORD: เปลี่ยนรหัสผ่านแล้ว session เดิมใช้ไม่ได้ทันที
  const sessionKey = crypto
    .createHash('sha256')
    .update(`session:${env.SECRET_KEY ?? crypto.randomBytes(32).toString('hex')}:${password ?? ''}`)
    .digest();

  const hostAllowed = (req) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    return hosts.some((h) => (h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h));
  };
  const originAllowed = (req) => {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
      return new URL(origin).host.toLowerCase() === String(req.headers.host ?? '').toLowerCase();
    } catch {
      return false;
    }
  };

  const sign = (expires) => crypto.createHmac('sha256', sessionKey).update(String(expires)).digest('hex');

  function sessionOf(req) {
    const m = String(req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([a-f0-9]{64})`));
    if (!m) return null;
    const [, expires, signature] = m;
    const expected = Buffer.from(sign(expires), 'hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected)) return null;
    return Number(expires) > Date.now() ? m[0] : null;
  }
  const authenticated = (req) => !password || !!sessionOf(req);

  function tooManyFailures(ip) {
    const recent = (failures.get(ip) ?? []).filter((t) => t > Date.now() - 15 * 60 * 1000);
    failures.set(ip, recent);
    return recent.length >= 10;
  }

  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const passwordMatches = (input) => !!password && crypto.timingSafeEqual(sha(input), sha(password));

  // หน้า demo ต้องเปิดได้จากเบราว์เซอร์ทดสอบที่ไม่มี cookie ล็อกอิน
  const PUBLIC_PATHS = [/^\/login$/, /^\/vendor\//, DEMO_PATH];

  function middleware(req, res, next) {
    if (!hostAllowed(req)) return res.status(421).send('Invalid Host header');
    if (authenticated(req) || PUBLIC_PATHS.some((p) => p.test(req.path))) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    res.redirect(`/login`);
  }

  function login(req, res) {
    const ip = req.ip ?? req.socket.remoteAddress;
    if (tooManyFailures(ip)) return res.redirect('/login?error=locked');
    if (!passwordMatches(req.body?.password)) {
      failures.get(ip).push(Date.now());
      return res.redirect('/login?error=1');
    }
    const expires = Date.now() + SESSION_MS;
    const token = `${expires}.${sign(expires)}`;
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`
    );
    res.redirect('/');
  }

  // session เป็น cookie ที่เซ็นไว้ จึงออกจากระบบด้วยการลบ cookie ในเบราว์เซอร์
  function logout(req, res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  }

  // ตรวจตอนเปิด WebSocket: คืนข้อความ error หรือ null ถ้าผ่าน
  function checkUpgrade(req) {
    if (!hostAllowed(req)) return 'Invalid Host header';
    if (!originAllowed(req)) return 'Invalid Origin';
    if (!authenticated(req)) return 'Unauthorized';
    return null;
  }

  return { enabled: !!password, middleware, login, logout, checkUpgrade };
}
