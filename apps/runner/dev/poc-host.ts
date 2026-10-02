// สะพานชั่วคราวสำหรับพัฒนา: เสิร์ฟหน้าเว็บของ PoC เดิม + REST API (อ่านเขียน Postgres) + เสียบ runner ใหม่เข้า /ws
// ใช้พิสูจน์ว่า runner/db ใหม่ทำงานเหมือน PoC เดิม โดยรันชุดเทส UI ของ PoC (POC_BACKEND=runner) เมื่อระบบเว็บใหม่
// (apps/web) ต่อกับ runner ได้ครบแล้ว ไฟล์นี้ไม่จำเป็นอีกต่อไป
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiStatus, createCipher } from '@test-studio/core';
import { openStore, runMigrations, seedIfEmpty, sql } from '@test-studio/db';
import express from 'express';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import { createRunner } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POC = path.resolve(here, '../../../poc-screencast');
const pocRequire = createRequire(path.join(POC, 'package.json'));

const config = loadConfig({
  PORT: process.env.PORT ?? '4310',
  HOST: '127.0.0.1',
  DATABASE_URL: process.env.DATABASE_URL,
  SECRET_KEY: process.env.SECRET_KEY ?? 'poc-host-dev-key',
  MAX_SESSIONS: process.env.MAX_SESSIONS ?? '8',
});

const store = openStore({ url: config.databaseUrl, cipher: createCipher(null, { SECRET_KEY: config.secretKey }) });
if (process.env.RESET_DB === 'true') {
  // ใช้กับฐานข้อมูลสำหรับเทสเท่านั้น: สร้างถ้ายังไม่มี แล้วล้างทุกอย่างให้เป็นฐานข้อมูลใหม่ (project id 1 ตามที่เทสของ PoC คาดไว้)
  const dbName = new URL(config.databaseUrl).pathname.slice(1);
  if (!/^[a-z0-9_]*(test|poc)[a-z0-9_]*$/i.test(dbName)) throw new Error('RESET_DB ใช้ได้เฉพาะฐานข้อมูลที่ชื่อมี test หรือ poc');
  const adminUrl = new URL(config.databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  if (!(await admin`select 1 from pg_database where datname = ${dbName}`).length) await admin.unsafe(`create database ${dbName}`);
  await admin.end();
  await store.db.execute(sql.raw('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;'));
}
await runMigrations(store.db);
await seedIfEmpty(store.repos);

const { repos } = store;
const app = express();
app.disable('x-powered-by');
app.use(express.json());

// ---------- หน้าเว็บของ PoC ----------
app.use(express.static(path.join(POC, 'public')));
app.use('/vendor/primer', express.static(path.join(POC, 'node_modules/@primer/css/dist')));
app.use('/vendor/primitives', express.static(path.join(POC, 'node_modules/@primer/primitives/dist/css')));
const octicons = pocRequire('@primer/octicons') as Record<string, { toSVG(): string }>;
const ICONS = [
  'dot-fill', 'square-fill', 'play', 'eye', 'quote', 'link', 'number', 'globe', 'pencil', 'check-circle-fill',
  'x-circle-fill', 'skip', 'grabber', 'trash', 'kebab-horizontal', 'download', 'copy', 'lock', 'plus', 'x',
  'arrow-left', 'arrow-right', 'sync', 'history', 'code', 'checklist', 'crosshairs', 'beaker', 'command-palette',
  'single-select', 'checkbox', 'square', 'cursor', 'info', 'alert', 'clock', 'triangle-down', 'file', 'project',
  'check', 'stop', 'light-bulb', 'list-ordered', 'chevron-down', 'chevron-right', 'stack', 'tools', 'link-external', 'sparkle-fill', 'shield-lock', 'sign-out',
];
const iconsJs = `window.ICONS = ${JSON.stringify(Object.fromEntries(ICONS.map((n) => [n, octicons[n]!.toSVG()])))};`;
app.get('/icons.js', (_req, res) => void res.type('js').send(iconsJs));

// ---------- REST (รูปแบบ snake_case ตามที่หน้าเว็บของ PoC คาดไว้) ----------
const id = (req: express.Request, key = 'id') => Number(req.params[key]);
const bad = (res: express.Response, error: string) => void res.status(400).json({ error });
const nameOf = (req: express.Request) => String(req.body?.name ?? '').trim();
const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler => (req, res, next) => void fn(req, res).catch(next);

app.get('/api/auth', (_req, res) => void res.json({ enabled: false }));
app.get('/api/ai/status', (_req, res) => void res.json(aiStatus()));

app.get('/api/projects', wrap(async (_req, res) => res.json(await repos.projects.list())));
app.post('/api/projects', wrap(async (req, res) => (nameOf(req) ? res.json({ id: await repos.projects.create(nameOf(req)) }) : bad(res, 'กรุณาระบุชื่อ'))));
app.delete('/api/projects/:id', wrap(async (req, res) => (await repos.projects.remove(id(req)), res.json({ ok: true }))));

app.get('/api/projects/:id/tests', wrap(async (req, res) => {
  const list = await repos.tests.list(id(req));
  res.json(list.map((t) => ({ id: t.id, name: t.name, updated_at: t.updatedAt, step_count: t.stepCount, last_passed: t.lastPassed })));
}));
app.post('/api/projects/:id/tests', wrap(async (req, res) => (nameOf(req) ? res.json({ id: await repos.tests.create(id(req), nameOf(req)) }) : bad(res, 'กรุณาระบุชื่อ'))));
app.get('/api/tests/:id', wrap(async (req, res) => {
  const t = await repos.tests.get(id(req));
  t ? res.json({ id: t.id, project_id: t.projectId, name: t.name }) : void res.status(404).json({ error: 'ไม่พบเทสเคสนี้' });
}));
app.patch('/api/tests/:id', wrap(async (req, res) => (nameOf(req) ? (await repos.tests.rename(id(req), nameOf(req)), res.json({ ok: true })) : bad(res, 'กรุณาระบุชื่อ'))));
app.delete('/api/tests/:id', wrap(async (req, res) => (await repos.tests.remove(id(req)), res.json({ ok: true }))));

// ตัวแปรลับ: ส่งกลับเฉพาะชื่อ ไม่ส่งค่าจริงออกไปหน้าเว็บ
app.get('/api/projects/:id/secrets', wrap(async (req, res) => res.json(await repos.secrets.names(id(req)))));
app.put('/api/projects/:id/secrets/:name', wrap(async (req, res) => {
  const name = String(req.params.name).toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return bad(res, 'ชื่อตัวแปรไม่ถูกต้อง');
  await repos.secrets.set(id(req), name, String(req.body?.value ?? ''));
  res.json({ ok: true });
}));
app.delete('/api/projects/:id/secrets/:name', wrap(async (req, res) => (await repos.secrets.remove(id(req), String(req.params.name)), res.json({ ok: true }))));

app.get('/api/tests/:id/runs', wrap(async (req, res) => {
  const list = await repos.runs.list(id(req));
  res.json(list.map((r) => ({ id: r.id, started_at: r.startedAt, duration_ms: r.durationMs, passed: r.passed, has_screenshot: r.hasScreenshot })));
}));
app.get('/api/runs/:id', wrap(async (req, res) => {
  const r = await repos.runs.get(id(req));
  r ? res.json({ id: r.id, test_id: r.testId, started_at: r.startedAt, duration_ms: r.durationMs, passed: r.passed, results: r.results, has_screenshot: r.hasScreenshot }) : void res.status(404).json({ error: 'ไม่พบการรันนี้' });
}));
app.get('/api/runs/:id/screenshot', wrap(async (req, res) => {
  const shot = await repos.runs.screenshot(id(req));
  shot ? void res.type('jpeg').send(shot) : void res.sendStatus(404);
}));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const runner = await createRunner({ store, config });
const server = createServer(app);
server.on('upgrade', runner.handleUpgrade);
server.listen(config.port, config.host, () => console.log(`poc-host: http://${config.host}:${config.port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    server.close();
    await runner.close();
    await store.close();
    process.exit(0);
  });
}
