// token อายุสั้นสำหรับเปิดการเชื่อมต่อ WebSocket กับ runner
// หน้าเว็บ (Next.js) ออกให้หลังผู้ใช้ล็อกอินแล้ว runner ตรวจด้วย secret ร่วมกัน
// (เบราว์เซอร์ใส่ header ให้ WebSocket ไม่ได้ จึงส่งใน query string และให้อายุสั้นมาก)
import crypto from 'node:crypto';

export interface RunnerTokenClaims {
  /** ผู้ใช้ที่ได้รับอนุญาต (เช่น อีเมล) */
  sub: string;
  /** เวลาหมดอายุ (ms) */
  exp: number;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (secret: string, payload: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

/** รูปแบบ: v1.<exp>.<sub แบบ base64url>.<ลายเซ็น> */
export function signRunnerToken(secret: string, sub: string, ttlMs = 60_000, now = Date.now()): string {
  if (!secret) throw new Error('ต้องระบุ secret');
  const payload = `v1.${now + ttlMs}.${b64(sub)}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** คืน claims ถ้า token ถูกต้องและยังไม่หมดอายุ ไม่เช่นนั้น null */
export function verifyRunnerToken(secret: string, token: string | null | undefined, now = Date.now()): RunnerTokenClaims | null {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [version, exp, sub, signature] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(secret, `${version}.${exp}.${sub}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return null;
  return { sub: Buffer.from(sub, 'base64url').toString('utf8'), exp: expiresAt };
}
