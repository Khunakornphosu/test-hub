import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDue, createBackup, pruneBackups } from '../src/backup.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'ts-backup-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

// Postgres ของเทสอยู่ในคอนเทนเนอร์ของ docker compose (ใช้ pg_dump ข้างในให้เวอร์ชันตรงกับ server)
const container = (() => {
  try {
    return execFileSync('docker', ['compose', 'ps', '-q', 'db'], { cwd: path.resolve(import.meta.dirname, '../../..') }).toString().trim() || null;
  } catch {
    return null;
  }
})();

describe('backupDue', () => {
  it('วันละครั้งหลังเวลาที่ตั้ง ตามเวลาไทย', () => {
    // 5 ต.ค. 2026 02:30 น. ไทย = 4 ต.ค. 19:30Z
    expect(backupDue(new Date('2026-10-04T19:30:00Z'), 3, null)).toBe(false);
    // 03:10 น. ไทย ยังไม่เคยสำรอง
    expect(backupDue(new Date('2026-10-04T20:10:00Z'), 3, null)).toBe(true);
    // สำรองแล้ววันนี้ (03:05 ไทย) ไม่ต้องซ้ำ
    expect(backupDue(new Date('2026-10-05T10:00:00Z'), 3, new Date('2026-10-04T20:05:00Z'))).toBe(false);
    // ครั้งล่าสุดเป็นของเมื่อวาน
    expect(backupDue(new Date('2026-10-05T10:00:00Z'), 3, new Date('2026-10-03T20:05:00Z'))).toBe(true);
  });
});

describe('pruneBackups', () => {
  it('ลบเฉพาะไฟล์สำรองของระบบที่เก่ากว่ากำหนด', async () => {
    const old = new Date(Date.now() - 20 * 86_400_000);
    for (const name of ['test-studio-2026-09-01_030000.sql.gz', 'test-studio-2026-09-01_030000-2.sql.gz', 'notes.sql.gz', 'test-studio-2026-10-05_030000.sql.gz']) await writeFile(path.join(dir, name), 'x');
    for (const name of ['test-studio-2026-09-01_030000.sql.gz', 'test-studio-2026-09-01_030000-2.sql.gz', 'notes.sql.gz']) await utimes(path.join(dir, name), old, old);
    expect((await pruneBackups(dir, 14)).sort()).toEqual(['test-studio-2026-09-01_030000-2.sql.gz', 'test-studio-2026-09-01_030000.sql.gz']);
    expect((await readdir(dir)).sort()).toEqual(['notes.sql.gz', 'test-studio-2026-10-05_030000.sql.gz']);
  });
});

describe.skipIf(!container)('createBackup', () => {
  it('dump ฐานข้อมูลจริงเป็น .sql.gz และไม่เขียนทับไฟล์ที่ชื่อซ้ำ', async () => {
    const now = new Date('2026-10-05T01:02:03Z');
    const first = await createBackup(process.env.TEST_DATABASE_URL!, { dir, dockerContainer: container! }, now);
    const second = await createBackup(process.env.TEST_DATABASE_URL!, { dir, dockerContainer: container! }, now);
    expect(path.basename(first.file)).toBe('test-studio-2026-10-05_080203.sql.gz');
    expect(path.basename(second.file)).toBe('test-studio-2026-10-05_080203-2.sql.gz');
    const sql = gunzipSync(await readFile(first.file)).toString();
    expect(sql).toContain('PostgreSQL database dump');
    expect(sql).toContain('CREATE TABLE public.runs');
    expect(first.bytes).toBeGreaterThan(500);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('สำรองไม่ได้: บอกเหตุผล และไม่ทิ้งไฟล์ค้าง', async () => {
    await expect(createBackup('postgres://test_studio:x@127.0.0.1:5433/no_such_db', { dir, dockerContainer: container! })).rejects.toThrow(/pg_dump ล้มเหลว.*no_such_db/);
    expect(await readdir(dir)).toEqual([]);
  });
});
