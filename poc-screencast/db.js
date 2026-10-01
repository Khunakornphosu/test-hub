// เก็บโปรเจกต์ เทสเคส ตัวแปรลับ และประวัติการรันใน SQLite (ไฟล์เดียว ไม่ต้องตั้ง server)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createCipher } from './security.js';

const DB_PATH = process.env.DB_PATH || 'data/test-studio.db';
mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
const cipher = createCipher(DB_PATH === ':memory:' ? null : path.dirname(DB_PATH));

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- ค่าลับแยกจาก step: step เก็บแค่ชื่อตัวแปร
  CREATE TABLE IF NOT EXISTS secrets (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (project_id, name)
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    results TEXT NOT NULL,
    screenshot BLOB
  );
`);

if (!db.prepare('SELECT 1 FROM projects LIMIT 1').get()) {
  const { lastInsertRowid } = db.prepare('INSERT INTO projects (name) VALUES (?)').run('โปรเจกต์ตัวอย่าง');
  db.prepare('INSERT INTO tests (project_id, name) VALUES (?, ?)').run(lastInsertRowid, 'Login Test');
}

const plain = (row) => (row ? { ...row } : row);

// เข้ารหัสตัวแปรลับที่ยังเป็นข้อความธรรมดา (บันทึกไว้ก่อนมีการเข้ารหัส)
for (const row of db.prepare('SELECT project_id, name, value FROM secrets').all()) {
  if (!cipher.isEncrypted(row.value)) {
    db.prepare('UPDATE secrets SET value = ? WHERE project_id = ? AND name = ?').run(
      cipher.encrypt(row.value),
      row.project_id,
      row.name
    );
  }
}

export const projects = {
  list: () => db.prepare('SELECT id, name FROM projects ORDER BY id').all().map(plain),
  create: (name) => Number(db.prepare('INSERT INTO projects (name) VALUES (?)').run(name).lastInsertRowid),
  remove: (id) => db.prepare('DELETE FROM projects WHERE id = ?').run(id),
};

export const tests = {
  list: (projectId) =>
    db
      .prepare(
        `SELECT t.id, t.name, t.updated_at, json_array_length(t.steps) AS step_count,
                (SELECT passed FROM runs r WHERE r.test_id = t.id ORDER BY r.id DESC LIMIT 1) AS last_passed
         FROM tests t WHERE t.project_id = ? ORDER BY t.id`
      )
      .all(projectId)
      .map(plain),
  get: (id) => {
    const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(id);
    return row && { ...row, steps: JSON.parse(row.steps) };
  },
  create: (projectId, name) =>
    Number(db.prepare('INSERT INTO tests (project_id, name) VALUES (?, ?)').run(projectId, name).lastInsertRowid),
  rename: (id, name) => db.prepare("UPDATE tests SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id),
  saveSteps: (id, steps) =>
    db.prepare("UPDATE tests SET steps = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(steps), id),
  remove: (id) => db.prepare('DELETE FROM tests WHERE id = ?').run(id),
};

export const secrets = {
  names: (projectId) =>
    db.prepare('SELECT name FROM secrets WHERE project_id = ? ORDER BY name').all(projectId).map((r) => r.name),
  values: (projectId) => {
    const out = {};
    for (const r of db.prepare('SELECT name, value FROM secrets WHERE project_id = ?').all(projectId)) {
      try {
        out[r.name] = cipher.decrypt(r.value);
      } catch {
        // ถอดรหัสไม่ได้ (เช่น เปลี่ยน SECRET_KEY) ถือว่ายังไม่ได้ตั้งค่า ผู้ใช้ต้องตั้งใหม่
        console.warn(`[security] ถอดรหัสตัวแปรลับ ${r.name} ไม่ได้ — SECRET_KEY อาจถูกเปลี่ยน`);
      }
    }
    return out;
  },
  set: (projectId, name, value) =>
    db
      .prepare(
        'INSERT INTO secrets (project_id, name, value) VALUES (?, ?, ?) ON CONFLICT (project_id, name) DO UPDATE SET value = excluded.value'
      )
      .run(projectId, name, cipher.encrypt(value)),
  remove: (projectId, name) => db.prepare('DELETE FROM secrets WHERE project_id = ? AND name = ?').run(projectId, name),
};

export const runs = {
  create: ({ testId, startedAt, durationMs, passed, results, screenshot }) =>
    Number(
      db
        .prepare(
          'INSERT INTO runs (test_id, started_at, duration_ms, passed, results, screenshot) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(testId, startedAt, durationMs, passed ? 1 : 0, JSON.stringify(results), screenshot ?? null).lastInsertRowid
    ),
  list: (testId) =>
    db
      .prepare(
        `SELECT id, started_at, duration_ms, passed, screenshot IS NOT NULL AS has_screenshot
         FROM runs WHERE test_id = ? ORDER BY id DESC LIMIT 50`
      )
      .all(testId)
      .map(plain),
  get: (id) => {
    const row = db
      .prepare('SELECT id, test_id, started_at, duration_ms, passed, results, screenshot IS NOT NULL AS has_screenshot FROM runs WHERE id = ?')
      .get(id);
    return row && { ...row, results: JSON.parse(row.results) };
  },
  screenshot: (id) => db.prepare('SELECT screenshot FROM runs WHERE id = ?').get(id)?.screenshot,
  // ผลรายสเต็ปของการรันล่าสุด ใช้คำนวณ locator health
  recentResults: (testId, limit = 20) =>
    db
      .prepare('SELECT results FROM runs WHERE test_id = ? ORDER BY id DESC LIMIT ?')
      .all(testId, limit)
      .map((r) => JSON.parse(r.results)),
};
