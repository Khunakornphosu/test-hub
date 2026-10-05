// ตรวจรหัสผ่านทีมก่อนเข้าทุกหน้า (เฉพาะเมื่อตั้ง ACCESS_PASSWORD) ยังไม่ล็อกอิน: หน้าเว็บไปหน้า /login, API ได้ 401
import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, accessCookieValid, accessPassword } from '@/server/access';

// เปิดได้โดยไม่ต้องล็อกอิน: หน้าล็อกอินและไฟล์ที่หน้านั้นใช้, health check, API ของ CI (ตรวจ token เอง) และหน้าทดสอบตัวอย่างที่เบราว์เซอร์ของ runner เปิด
const PUBLIC = [/^\/login$/, /^\/api\/(login|health)$/, /^\/api\/ci\//, /^\/_next\//, /^\/public\/build\//, /^\/favicon\.ico$/, /^\/demo-[\w-]+\.html$/];

export function proxy(request: NextRequest) {
  const password = accessPassword();
  const path = request.nextUrl.pathname;
  if (!password || PUBLIC.some((re) => re.test(path))) return NextResponse.next();
  if (accessCookieValid(request.cookies.get(ACCESS_COOKIE)?.value, password)) return NextResponse.next();
  if (path.startsWith('/api/')) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบด้วยรหัสผ่านของทีม' }, { status: 401 });
  const login = new URL('/login', request.url);
  login.searchParams.set('next', path + request.nextUrl.search);
  return NextResponse.redirect(login);
}
