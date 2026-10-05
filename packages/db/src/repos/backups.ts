import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { backups } from '../schema.js';

export interface BackupRecord { id: number; file: string | null; bytes: number | null; ok: boolean; error: string | null; durationMs: number; createdAt: Date }
const columns = { id: backups.id, file: backups.file, bytes: backups.bytes, ok: backups.ok, error: backups.error, durationMs: backups.durationMs, createdAt: backups.createdAt };
/** key ของ advisory lock: runner หลายตัวไม่สำรองพร้อมกัน */
const LOCK_KEY = 74_280_001;

export function backupsRepo(db: Db) {
  return {
    async record(value: { file: string | null; bytes: number | null; ok: boolean; error: string | null; durationMs: number }): Promise<number> {
      const [row] = await db.insert(backups).values(value).returning({ id: backups.id });
      return row!.id;
    },
    async recent(limit = 10): Promise<BackupRecord[]> {
      return db.select(columns).from(backups).orderBy(desc(backups.id)).limit(limit);
    },
    async lastSuccess(): Promise<BackupRecord | null> {
      const [row] = await db.select(columns).from(backups).where(eq(backups.ok, true)).orderBy(desc(backups.id)).limit(1);
      return row ?? null;
    },
    /** ทำงานเฉพาะตอนได้ lock (ไม่ได้ = มี runner อื่นกำลังสำรองอยู่ คืน null) */
    async exclusive<T>(fn: () => Promise<T>): Promise<T | null> {
      return db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`);
        return lock?.locked ? fn() : null;
      });
    },
  };
}
