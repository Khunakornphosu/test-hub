import { and, asc, eq } from 'drizzle-orm';
import type { Cipher } from '@test-studio/core';
import type { Db } from '../client.js';
import { secrets } from '../schema.js';

/**
 * ตัวแปรลับของโปรเจกต์ เก็บแบบเข้ารหัส
 * names() ใช้แสดงในหน้าเว็บ (ไม่มีค่า) ส่วน values() คืนค่าจริงให้เฉพาะ runner ตอนรันเทส
 */
export function secretsRepo(db: Db, cipher: Cipher) {
  return {
    async names(projectId: number): Promise<string[]> {
      const rows = await db.select({ name: secrets.name }).from(secrets).where(eq(secrets.projectId, projectId)).orderBy(asc(secrets.name));
      return rows.map((r) => r.name);
    },
    async values(projectId: number): Promise<Record<string, string>> {
      const rows = await db.select().from(secrets).where(eq(secrets.projectId, projectId));
      const out: Record<string, string> = {};
      for (const r of rows) {
        try {
          out[r.name] = cipher.decrypt(r.value);
        } catch {
          // ถอดรหัสไม่ได้ (เช่น เปลี่ยน SECRET_KEY) ถือว่ายังไม่ได้ตั้งค่า ผู้ใช้ต้องตั้งใหม่
          console.warn(`[security] ถอดรหัสตัวแปรลับ ${r.name} ไม่ได้ — SECRET_KEY อาจถูกเปลี่ยน`);
        }
      }
      return out;
    },
    async set(projectId: number, name: string, value: string): Promise<void> {
      const encrypted = cipher.encrypt(value);
      await db
        .insert(secrets)
        .values({ projectId, name, value: encrypted })
        .onConflictDoUpdate({ target: [secrets.projectId, secrets.name], set: { value: encrypted } });
    },
    async remove(projectId: number, name: string): Promise<void> {
      await db.delete(secrets).where(and(eq(secrets.projectId, projectId), eq(secrets.name, name)));
    },
  };
}
