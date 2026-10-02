// ความปลอดภัย: ส่วนกัน SSRF และเข้ารหัสตัวแปรลับย้ายไปอยู่ใน packages/core แล้ว (ส่งต่อที่นี่)
// ส่วนควบคุมการเข้าใช้งาน (รหัสผ่านเดียว/Host/Origin) เป็นของ PoC นี้โดยเฉพาะ ระบบใหม่จะใช้ Google login แทน
import crypto from 'node:crypto';
import { DEMO_PATH } from '../packages/core/dist/security/index.js';

export { createCipher, createUrlGuard, startGuardProxy } from '../packages/core/dist/security/index.js';

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
