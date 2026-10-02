// ย้ายข้อมูลจากต้นแบบเดิม (SQLite ใน poc-screencast/data) เข้า Postgres
// - คง id เดิมไว้ (ลิงก์/อ้างอิงยังตรง) แล้วปรับ sequence ให้ต่อจากเลขสูงสุด
// - ตัวแปรลับถอดรหัสด้วย key ของ PoC แล้วเข้ารหัสใหม่ด้วย key ของระบบใหม่ (ค่าจริงไม่ผ่านที่อื่น)
// - ตรวจ step ด้วย stepSchema: เทสที่มี step ผิดรูปแบบจะไม่ถูกย้ายและรายงานให้ทราบ
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCipher, runResultsSchema, testStepsSchema } from '@test-studio/core';
import { sql } from 'drizzle-orm';
import type { Store } from './index.js';
import { projects, runs, secrets, tests } from './schema.js';

export interface ImportReport {
  projects: number;
  tests: number;
  secrets: number;
  runs: number;
  skipped: string[];
}

interface Row {
  [column: string]: unknown;
}

// SQLite เก็บเวลาแบบ 'YYYY-MM-DD HH:MM:SS' (UTC) ส่วน runs เก็บเป็น ISO
const toDate = (v: unknown) => new Date(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`);

export async function importPoc(store: Store, pocDataDir: string, options: { force?: boolean } = {}): Promise<ImportReport> {
  const dbFile = path.join(pocDataDir, 'test-studio.db');
  if (!fs.existsSync(dbFile)) throw new Error(`ไม่พบฐานข้อมูล PoC ที่ ${dbFile}`);
  if (!options.force && (await store.repos.projects.list()).length) {
    throw new Error('ฐานข้อมูลปลายทางมีข้อมูลอยู่แล้ว (ใช้ --force ถ้าต้องการนำเข้าเพิ่ม)');
  }
  const source = new DatabaseSync(dbFile, { readOnly: true });
  const pocCipher = createCipher(pocDataDir, {}); // key ของ PoC: SECRET_KEY ใน env ของ PoC หรือไฟล์ secret.key
  const report: ImportReport = { projects: 0, tests: 0, secrets: 0, runs: 0, skipped: [] };
  const all = (query: string) => source.prepare(query).all() as Row[];

  try {
    await store.db.transaction(async (tx) => {
      const validTests = new Set<number>();
      for (const p of all('SELECT * FROM projects ORDER BY id')) {
        await tx.insert(projects).values({ id: Number(p.id), name: String(p.name), createdAt: toDate(p.created_at) });
        report.projects++;
      }
      for (const t of all('SELECT * FROM tests ORDER BY id')) {
        const parsed = testStepsSchema.safeParse(JSON.parse(String(t.steps)));
        if (!parsed.success) {
          report.skipped.push(`เทส #${t.id} "${t.name}": step ผิดรูปแบบ (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message})`);
          continue;
        }
        await tx.insert(tests).values({ id: Number(t.id), projectId: Number(t.project_id), name: String(t.name), steps: parsed.data, createdAt: toDate(t.created_at), updatedAt: toDate(t.updated_at) });
        validTests.add(Number(t.id));
        report.tests++;
      }
      for (const s of all('SELECT * FROM secrets')) {
        const plain = pocCipher.decrypt(String(s.value));
        await tx.insert(secrets).values({ projectId: Number(s.project_id), name: String(s.name), value: store.cipher.encrypt(plain) });
        report.secrets++;
      }
      for (const r of all('SELECT * FROM runs ORDER BY id')) {
        if (!validTests.has(Number(r.test_id))) {
          report.skipped.push(`การรัน #${r.id}: เทส #${r.test_id} ไม่ได้ถูกย้าย`);
          continue;
        }
        const results = runResultsSchema.safeParse(JSON.parse(String(r.results)));
        if (!results.success) {
          report.skipped.push(`การรัน #${r.id}: ผลรันผิดรูปแบบ`);
          continue;
        }
        await tx.insert(runs).values({
          id: Number(r.id),
          testId: Number(r.test_id),
          startedAt: toDate(r.started_at),
          durationMs: Number(r.duration_ms),
          passed: Boolean(r.passed),
          results: results.data,
          screenshot: r.screenshot ? Buffer.from(r.screenshot as Uint8Array) : null,
        });
        report.runs++;
      }
      // id ถูกกำหนดเอง จึงต้องปรับ sequence ให้ค่าถัดไปไม่ชนของเดิม
      for (const table of ['projects', 'tests', 'runs']) {
        await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}', 'id'), greatest((select coalesce(max(id), 0) from ${table}), 1), (select count(*) > 0 from ${table}))`));
      }
    });
  } finally {
    source.close();
  }
  return report;
}
