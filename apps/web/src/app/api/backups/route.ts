import path from 'node:path';
import { route } from '@/server/route';

export const dynamic = 'force-dynamic';

/** ประวัติการสำรองล่าสุด (แสดงแค่ชื่อไฟล์ ไม่แสดง path เต็มของเครื่อง) */
export const GET = route(async ({ store }) => {
  const [recent, last] = await Promise.all([store.repos.backups.recent(10), store.repos.backups.lastSuccess()]);
  return {
    lastSuccessAt: last?.createdAt ?? null,
    items: recent.map((b) => ({ id: b.id, file: b.file ? path.basename(b.file) : null, bytes: b.bytes, ok: b.ok, error: b.error, createdAt: b.createdAt })),
  };
});
