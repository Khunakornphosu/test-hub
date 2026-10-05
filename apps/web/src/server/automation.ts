// ตัวช่วยของ API รันอัตโนมัติ: ตรวจว่าเป้าหมาย/environment เป็นของโปรเจกต์นั้นจริง
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { createUrlGuard, describeTiming, runTargetSchema, scheduleTimingSchema, type RunTarget, type UrlGuard } from '@test-studio/core';
import type { BatchRecord, ScheduleRecord, Store } from '@test-studio/db';
import { HttpError } from './route';

export async function assertTarget(store: Store, projectId: number, target: RunTarget): Promise<string> {
  if (target.type === 'project') return 'ทั้งโปรเจกต์';
  if (target.type === 'test') {
    const test = await store.repos.tests.get(target.id);
    if (!test || test.projectId !== projectId) throw new HttpError(400, 'ไม่พบเทสนี้ในโปรเจกต์');
    return `เทส "${test.name}"`;
  }
  const flow = await store.repos.flows.get(target.id);
  if (!flow || flow.projectId !== projectId) throw new HttpError(400, 'ไม่พบ Flow นี้ในโปรเจกต์');
  return `Flow "${flow.name}"`;
}

export async function assertEnvironment(store: Store, projectId: number, environmentId: number | null) {
  if (environmentId == null) return null;
  const env = await store.repos.environments.get(environmentId);
  if (!env || env.projectId !== projectId) throw new HttpError(400, 'ไม่พบ environment นี้ในโปรเจกต์');
  return env;
}

export async function scheduleView(store: Store, s: ScheduleRecord) {
  return { ...s, timingLabel: describeTiming(s.timing), targetLabel: await assertTarget(store, s.projectId, s.target).catch(() => 'เป้าหมายถูกลบไปแล้ว') };
}

let guard: UrlGuard | null = null;
/** ปลายทางแจ้งเตือนมาจากผู้ใช้ ต้องผ่านการกันเครือข่ายภายในเหมือน runner (ใช้ ALLOWED_HOSTS / ALLOW_PRIVATE_NETWORK ชุดเดียวกัน) */
export function urlGuard(): UrlGuard {
  return (guard ??= createUrlGuard({ appPort: Number(process.env.PORT) || 4700 }));
}

export const scheduleSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อ').max(80, 'ชื่อยาวเกินไป'),
  target: runTargetSchema,
  timing: scheduleTimingSchema,
  environmentId: z.number().int().positive().nullable(),
  enabled: z.boolean().default(true),
});

/** ผลรวมของรอบ: null = ยังรันไม่จบ */
export function batchView(b: BatchRecord) {
  return { ...b, passed: b.status === 'done' ? b.failed === 0 : b.status === 'error' ? false : null };
}

/** ตรวจ token ของ CI จาก header Authorization: Bearer tsk_… คืนโปรเจกต์ของ token */
export async function ciProject(req: Request, store: Store): Promise<number> {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'ต้องส่ง Authorization: Bearer <token>');
  const found = await store.repos.tokens.verify(token);
  if (!found) throw new HttpError(401, 'token ไม่ถูกต้องหรือถูกลบไปแล้ว');
  return found.projectId;
}

/** origin ที่ผู้ใช้เห็น (อยู่หลัง tunnel/proxy ได้) ใช้ทำลิงก์ผลการรันให้ CI */
export function publicOrigin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export function ciError(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });
  if (err instanceof SyntaxError) return NextResponse.json({ error: 'ข้อมูลที่ส่งมาไม่ใช่ JSON' }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, { status: 500 });
}
