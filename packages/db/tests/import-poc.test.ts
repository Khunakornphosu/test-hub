import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCipher } from '@test-studio/core';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { importPoc, openStore } from '../src/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// สร้างฐานข้อมูลหน้าตาเหมือน PoC (SQLite + ตัวแปรลับที่เข้ารหัสด้วย key ของ PoC)
function makePoc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-'));
  dirs.push(dir);
  const pocCipher = createCipher(dir, {});
  const db = new DatabaseSync(path.join(dir, 'test-studio.db'));
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE tests (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE secrets (project_id INTEGER NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (project_id, name));
    CREATE TABLE runs (id INTEGER PRIMARY KEY, test_id INTEGER NOT NULL, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, passed INTEGER NOT NULL, results TEXT NOT NULL, screenshot BLOB);
  `);
  const goodSteps = [{ id: 1, action: 'goto', value: 'https://a.test/' }, { id: 2, action: 'fill', locator: { type: 'label', value: 'รหัสผ่าน' }, secret: 'TEST_PASSWORD' }];
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (4, 'Shop', '2026-09-30 08:00:00')").run();
  db.prepare("INSERT INTO tests (id, project_id, name, steps, created_at, updated_at) VALUES (7, 4, 'Login', ?, '2026-09-30 08:01:00', '2026-09-30 09:00:00')").run(JSON.stringify(goodSteps));
  db.prepare("INSERT INTO tests (id, project_id, name, steps) VALUES (8, 4, 'เสีย', ?)").run(JSON.stringify([{ action: 'click' }]));
  db.prepare('INSERT INTO secrets VALUES (4, ?, ?)').run('TEST_PASSWORD', pocCipher.encrypt('pass-จริง-1234'));
  db.prepare('INSERT INTO secrets VALUES (4, ?, ?)').run('LEGACY', 'plain-before-encryption');
  db.prepare("INSERT INTO runs VALUES (12, 7, '2026-10-01T03:00:00.000Z', 150, 1, ?, NULL)").run(JSON.stringify([{ stepId: 1, label: 'เปิด', status: 'passed', ms: 10 }]));
  db.prepare("INSERT INTO runs VALUES (13, 7, '2026-10-01T04:00:00.000Z', 5200, 0, ?, ?)").run(JSON.stringify([{ stepId: 2, label: 'พิมพ์', status: 'failed', error: 'x' }]), Buffer.from([0xff, 0xd8, 9]));
  db.prepare("INSERT INTO runs VALUES (14, 8, '2026-10-01T05:00:00.000Z', 1, 1, '[]', NULL)").run();
  db.close();
  return dir;
}

describe('importPoc', () => {
  it('ย้ายข้อมูลโดยคง id เดิม เข้ารหัสตัวแปรลับใหม่ และข้ามเทสที่ step ผิดรูปแบบ', async () => {
    // ล้างตารางของ DB เทส (ไฟล์เทสรันทีละไฟล์ ดู vitest.config.ts) แล้วรีเซ็ต sequence ให้เหมือนฐานข้อมูลใหม่
    const raw = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
    await raw.unsafe('truncate projects, tests, secrets, runs restart identity cascade');
    await raw.end();
    const store = openStore({ url: process.env.TEST_DATABASE_URL, cipher: createCipher(null, { SECRET_KEY: 'new-system-key' }), max: 1 });
    try {
      const report = await importPoc(store, makePoc());
      expect(report).toMatchObject({ projects: 1, tests: 1, secrets: 2, runs: 2 });
      expect(report.skipped.map((s) => s.split(':')[0])).toEqual(['เทส #8 "เสีย"', 'การรัน #14']);

      expect(await store.repos.projects.list()).toEqual([{ id: 4, name: 'Shop' }]);
      const test = await store.repos.tests.get(7);
      expect(test?.steps).toHaveLength(2);
      expect(test?.createdAt.toISOString()).toBe('2026-09-30T08:01:00.000Z');
      expect(test?.updatedAt.toISOString()).toBe('2026-09-30T09:00:00.000Z');
      expect(await store.repos.secrets.values(4)).toEqual({ TEST_PASSWORD: 'pass-จริง-1234', LEGACY: 'plain-before-encryption' });
      const history = await store.repos.runs.list(7);
      expect(history.map((r) => [r.id, r.passed, r.hasScreenshot])).toEqual([[13, false, true], [12, true, false]]);
      expect(await store.repos.runs.screenshot(13)).toEqual(Buffer.from([0xff, 0xd8, 9]));

      // เลข id ถัดไปต้องไม่ชนของที่ย้ายมา
      expect(await store.repos.projects.create('ใหม่')).toBeGreaterThan(4);
      expect(await store.repos.tests.create(4, 'ใหม่')).toBeGreaterThan(7);

      // นำเข้าซ้ำโดยไม่ใส่ force ต้องไม่ทับข้อมูลที่มี
      await expect(importPoc(store, makePoc())).rejects.toThrow('มีข้อมูลอยู่แล้ว');
      await expect(importPoc(store, '/nonexistent')).rejects.toThrow('ไม่พบฐานข้อมูล PoC');
    } finally {
      await store.close();
    }
  });
});
