// รหัสผ่านทีม: ใช้ตอนเปิดให้คนอื่นเข้าผ่าน tunnel ก่อนจะมีระบบ login จริง (เปิดเมื่อตั้ง ACCESS_PASSWORD เท่านั้น)
// cookie = "<หมดอายุ>.<HMAC ของเวลาหมดอายุ>" ใช้รหัสผ่านเป็น key จึงปลอมไม่ได้ และเปลี่ยนรหัสแล้ว cookie เดิมใช้ไม่ได้ทันที
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'ts_access';
export const ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;

export const accessPassword = (): string | null => process.env.ACCESS_PASSWORD || null;

const sha = (value: string) => createHash('sha256').update(value).digest();
const sign = (password: string, expires: number) => createHmac('sha256', password).update(`access:${expires}`).digest('base64url');

export function passwordMatches(given: string, password: string): boolean {
  return timingSafeEqual(sha(given), sha(password));
}

export function issueAccessCookie(password: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + ACCESS_TTL_SECONDS;
  return `${expires}.${sign(password, expires)}`;
}

export function accessCookieValid(value: string | undefined, password: string, now = Date.now()): boolean {
  if (!value) return false;
  const [rawExpires, signature] = value.split('.');
  const expires = Number(rawExpires);
  if (!Number.isInteger(expires) || !signature || expires * 1000 < now) return false;
  const expected = sign(password, expires);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const isHttps = (request: Request) => request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
