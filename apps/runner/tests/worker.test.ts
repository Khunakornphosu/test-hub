// worker รันอัตโนมัติ: Chromium จริง + Postgres จริง แต่ส่งแจ้งเตือนเข้าตัวเก็บแทนการยิงออกไปข้างนอก
import { createServer, type Server } from 'node:http';
import { createCipher, createUrlGuard, type BatchNotice, type ChannelConfig } from '@test-studio/core';
import { openStore, type Store } from '@test-studio/db';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startWorker, type Worker } from '../src/worker.js';

let store: Store;
let browser: Browser;
let server: Server;
let base = '';
let worker: Worker | null = null;
const sent: { config: ChannelConfig; notice: BatchNotice }[] = [];
const visited: string[] = [];

beforeAll(async () => {
  store = openStore({ url: process.env.TEST_DATABASE_URL, cipher: createCipher(null, { SECRET_KEY: 'worker-test-key' }), max: 3 });
  server = createServer((req, res) => {
    visited.push(`${req.headers.host}${req.url}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><title>t</title><h1>${req.url?.startsWith('/stg') ? 'staging' : 'production'}</h1>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await worker?.stop();
  await browser.close();
  server.close();
  await store.close();
});
beforeEach(() => {
  sent.length = 0;
  visited.length = 0;
});

async function setup() {
  await worker?.stop();
  // เทสนี้เปิดหน้าเว็บของ server ในเครื่อง จึงอนุญาตเครือข่ายภายใน (ปกติห้าม)
  const urlGuard = createUrlGuard({ appPort: 1, env: { ALLOW_PRIVATE_NETWORK: 'true' } });
  worker = startWorker({ store, browser, urlGuard, pollMs: 3_600_000, publicAppUrl: 'https://ts.test/', notify: async (config, notice) => { sent.push({ config, notice }); }, log: () => {} });
  await worker.tick();
  const projectId = await store.repos.projects.create(`worker ${Date.now()}`);
  const pass = await store.repos.tests.create(projectId, 'หน้าแรก');
  await store.repos.tests.saveSteps(pass, [
    { id: 1, action: 'goto', value: `${base}/home` },
    { id: 2, action: 'assertText', locator: { type: 'css', value: 'h1' }, expected: 'production' },
  ]);
  const fail = await store.repos.tests.create(projectId, 'พังเสมอ');
  await store.repos.tests.saveSteps(fail, [{ id: 1, action: 'goto', value: `${base}/x` }, { id: 2, action: 'assertURL', expected: 'https://never.test/' }]);
  await store.repos.tests.create(projectId, 'ยังไม่มี step');
  await store.repos.channels.create(projectId, { name: 'Slack', config: { type: 'slack', url: 'https://hooks.slack.com/services/a/b/c' }, notifyOn: 'problems' });
  return { projectId, pass, fail };
}

describe('worker', () => {
  it('รันทั้งโปรเจกต์ (ข้ามเทสที่ไม่มี step) บันทึกผลผูกกับรอบ และแจ้งเตือนเมื่อไม่ผ่าน', async () => {
    const { projectId, fail } = await setup();
    const batchId = await store.repos.batches.enqueue({ projectId, target: { type: 'project' }, trigger: 'manual', label: 'กดรัน' });
    await worker!.tick();

    expect(await store.repos.batches.get(batchId)).toMatchObject({ status: 'done', total: 2, failed: 1, error: null });
    const runs = await store.repos.runs.listPage({ batchId, limit: 10, offset: 0 });
    expect(runs.total).toBe(2);
    expect(runs.items.map((r) => [r.testName, r.passed]).sort()).toEqual([['พังเสมอ', false], ['หน้าแรก', true]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.notice).toMatchObject({ label: 'กดรัน', trigger: 'manual', total: 2, failed: 1, url: `https://ts.test/runs?batch=${batchId}&project=all` });
    expect(sent[0]!.notice.failures).toEqual([{ testName: 'พังเสมอ', error: expect.stringContaining('URL ไม่ตรง') }]);

    // แก้เทสให้ผ่าน: รอบถัดไปแจ้ง "กลับมาผ่าน" ส่วนรอบที่ผ่านติดกันไม่แจ้ง
    await store.repos.tests.saveSteps(fail, [{ id: 1, action: 'goto', value: `${base}/x` }]);
    await store.repos.batches.enqueue({ projectId, target: { type: 'project' }, trigger: 'manual', label: 'กดรัน' });
    await worker!.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.notice).toMatchObject({ failed: 0, recovered: true });
    await store.repos.batches.enqueue({ projectId, target: { type: 'project' }, trigger: 'manual', label: 'กดรัน' });
    await worker!.tick();
    expect(sent).toHaveLength(2);
  }, 60_000);

  it('environment เปลี่ยนโดเมนของ step เปิดหน้าเว็บ', async () => {
    const { projectId, pass } = await setup();
    const port = new URL(base).port;
    const envId = await store.repos.environments.create(projectId, { name: 'staging', baseUrl: `http://localhost:${port}/stg` });
    const batchId = await store.repos.batches.enqueue({ projectId, target: { type: 'test', id: pass }, trigger: 'api', label: 'CI', environmentId: envId, environmentName: 'staging' });
    await worker!.tick();
    expect(visited).toContain(`localhost:${port}/stg/home`);
    // หน้า staging แสดงคำว่า staging จึงไม่ผ่าน assertText ของ production
    expect(await store.repos.batches.get(batchId)).toMatchObject({ status: 'done', total: 1, failed: 1 });
    expect(sent[0]!.notice.environmentName).toBe('staging');
  }, 60_000);

  it('Flow: ไม่ผ่านแล้วข้ามเทสที่เหลือในเส้นทางเดียวกัน แต่เส้นทางอื่นยังรัน', async () => {
    const { projectId, pass, fail } = await setup();
    const flowId = await store.repos.flows.create(projectId, 'สั่งซื้อ');
    await store.repos.flows.update(flowId, {
      nodes: [
        { id: 'a', type: 'testCase', testId: fail, position: { x: 0, y: 0 } },
        { id: 'b', type: 'testCase', testId: pass, position: { x: 1, y: 0 } },
        { id: 'c', type: 'testCase', testId: pass, position: { x: 0, y: 1 } },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    });
    const batchId = await store.repos.batches.enqueue({ projectId, target: { type: 'flow', id: flowId }, trigger: 'schedule', label: 'Flow' });
    await worker!.tick();
    // เส้นทาง a→b: a พัง b ถูกข้าม, เส้นทาง c: ผ่าน
    expect(await store.repos.batches.get(batchId)).toMatchObject({ status: 'done', total: 2, failed: 1 });
  }, 60_000);

  it('รันไม่ได้ (ไม่พบเทส) ปิดรอบเป็น error พร้อมเหตุผล และแจ้งเตือน', async () => {
    const { projectId } = await setup();
    const batchId = await store.repos.batches.enqueue({ projectId, target: { type: 'test', id: 999_999 }, trigger: 'api', label: 'CI' });
    await worker!.tick();
    expect(await store.repos.batches.get(batchId)).toMatchObject({ status: 'error', error: 'ไม่พบเทสที่ตั้งไว้ (อาจถูกลบไปแล้ว)' });
    expect(sent[0]!.notice.error).toBe('ไม่พบเทสที่ตั้งไว้ (อาจถูกลบไปแล้ว)');
  }, 60_000);

  it('ตารางเวลาที่ถึงเวลาถูกใส่คิวและรันในรอบเดียวกัน', async () => {
    const { projectId, pass } = await setup();
    const scheduleId = await store.repos.schedules.create(projectId, { name: 'ทุก 15 นาที', target: { type: 'test', id: pass }, timing: { kind: 'interval', minutes: 15 }, environmentId: null, enabled: true }, new Date(Date.now() - 20 * 60_000));
    await worker!.tick();
    const { items } = await store.repos.batches.list(projectId, { limit: 5, offset: 0 });
    expect(items[0]).toMatchObject({ scheduleId, trigger: 'schedule', status: 'done', total: 1, failed: 0 });
    expect((await store.repos.schedules.get(scheduleId))!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  }, 60_000);
});
