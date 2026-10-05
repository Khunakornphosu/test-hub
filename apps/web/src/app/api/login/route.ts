import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, accessCookieValid, accessPassword, isHttps, issueAccessCookie, passwordMatches } from '@/server/access';

export const dynamic = 'force-dynamic';

// กันเดารหัส: นับจำนวนครั้งที่ใส่ผิดต่อ IP ในช่วงเวลาหนึ่ง (เก็บในหน่วยความจำ พอสำหรับ server เดียว)
const WINDOW_MS = 5 * 60_000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();
const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

const sameOrigin = (req: Request) => {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
};

/** หน้าเว็บใช้ดูว่าต้องล็อกอินไหม (แสดงปุ่มออกจากระบบ) */
export function GET(req: Request) {
  const password = accessPassword();
  const cookie = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`))?.[1];
  return NextResponse.json({ required: !!password, authenticated: !password || accessCookieValid(cookie, password) });
}

export async function POST(req: Request) {
  const password = accessPassword();
  if (!password) return NextResponse.json({ ok: true });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'คำขอนี้มาจากเว็บอื่น' }, { status: 403 });

  const ip = clientIp(req);
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) {
    return NextResponse.json({ error: `ใส่รหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก ${Math.ceil((entry.resetAt - now) / 60_000)} นาที` }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const given = typeof body?.password === 'string' ? body.password : '';
  if (!given || !passwordMatches(given, password)) {
    const next = entry && entry.resetAt > now ? { count: entry.count + 1, resetAt: entry.resetAt } : { count: 1, resetAt: now + WINDOW_MS };
    failures.set(ip, next);
    return NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
  }

  failures.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, issueAccessCookie(password), { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: ACCESS_TTL_SECONDS });
  return res;
}
