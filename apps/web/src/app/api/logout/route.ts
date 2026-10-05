import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, isHttps } from '@/server/access';

export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: 0 });
  return res;
}
