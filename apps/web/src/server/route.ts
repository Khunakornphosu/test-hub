// ตัวช่วยของ route handler: ตรวจผู้ใช้, กัน CSRF, ตรวจ input ด้วย zod, แปลง error เป็นข้อความภาษาไทย
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { getUser, type User } from './auth';
import { getStore } from './store';
import type { Store } from '@test-studio/db';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `ไม่พบ${what}`);

/** คำสั่งที่แก้ข้อมูลต้องมาจากหน้าเว็บของเราเอง (กัน CSRF) Origin ที่ไม่มี = ไม่ใช่เบราว์เซอร์ จึงยอมรับ */
function assertSameOrigin(req: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origin ไม่ถูกต้อง');
  }
  if (originHost !== req.headers.get('host')) throw new HttpError(403, 'คำขอนี้มาจากเว็บอื่น');
}

export interface Ctx<P> {
  req: Request;
  params: P;
  user: User;
  store: Store;
}

type Handler<P> = (ctx: Ctx<P>) => Promise<unknown> | unknown;

export function route<P extends Record<string, string> = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, { params }: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const user = getUser(req);
      if (!user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
      const result = await handler({ req, params: await params, user, store: await getStore() });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });
      console.error(err);
      // ไม่ส่งรายละเอียดภายใน (เช่น ข้อความจากฐานข้อมูล) ออกไปให้ผู้ใช้
      return NextResponse.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, { status: 500 });
    }
  };
}

/** อ่าน id จาก path (ต้องเป็นจำนวนเต็มบวก) */
export function idParam(value: string, what = 'รายการ'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${what}ไม่ถูกต้อง`);
  return id;
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => {
    throw new HttpError(400, 'ข้อมูลที่ส่งมาไม่ใช่ JSON');
  });
  return schema.parse(json);
}
