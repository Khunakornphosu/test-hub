import { createCipher, type RunStepResult } from '@test-studio/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseBucketMs, openStore, type Store } from '../src/index.js';
import { resetDb } from './helpers.js';

let store: Store;
let raw: ReturnType<typeof postgres>;
const NOW = new Date('2026-10-02T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms);
const H = 3600_000;
const step = (stepId: number, status: RunStepResult['status'], extra: Partial<RunStepResult> = {}): RunStepResult => ({ stepId, label: `s${stepId}`, status, ...extra });
const healed = (testId: number, stepId: number) => [{ testId, stepId, locator: { type: 'css' as const, value: '#x' }, label: 'l' }];

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL!;
  await resetDb(url);
  raw = postgres(url, { max: 1 });
  store = openStore({ url, cipher: createCipher(null, { SECRET_KEY: 'k' }), max: 2 });
});
afterAll(async () => {
  await raw.end();
  await store.close();
});

describe('chooseBucketMs', () => {
  it('เลือกขนาดช่องที่ดูง่ายตามความยาวช่วงเวลา', () => {
    expect(chooseBucketMs(0, 1 * H)).toBe(5 * 60e3); // 1 ชม. -> ช่องละ 5 นาที (12 ช่อง)
    expect(chooseBucketMs(0, 10 * 60e3)).toBe(60e3);
    expect(chooseBucketMs(0, 24 * H)).toBe(30 * 60e3);
    expect(chooseBucketMs(0, 7 * 24 * H)).toBe(3 * H);
    expect(chooseBucketMs(0, 30 * 24 * H)).toBe(24 * H); // 30 วัน -> รายวัน
    expect(chooseBucketMs(0, 3650 * 24 * H)).toBe(24 * H); // ไม่เกินรายวัน
  });
});

describe('stats.overview', () => {
  let pA: number;
  let pB: number;
  let login: number;
  let checkout: number;
  let other: number;

  beforeAll(async () => {
    pA = await store.repos.projects.create('A');
    pB = await store.repos.projects.create('B');
    login = await store.repos.tests.create(pA, 'Login');
    checkout = await store.repos.tests.create(pA, 'Checkout');
    other = await store.repos.tests.create(pB, 'Other');
    const run = (testId: number, at: Date, durationMs: number, passed: boolean, results: RunStepResult[]) =>
      store.repos.runs.create({ testId, startedAt: at, durationMs, passed, results });
    // Login: ผ่านเรียบร้อย 3 ครั้ง (ครั้งที่ 2 ซ่อม locator ได้)
    await run(login, ago(30 * H), 2000, true, [step(1, 'passed')]);
    await run(login, ago(5 * H), 3000, true, [step(1, 'passed', { healed: healed(login, 1) })]);
    await run(login, ago(1 * H), 4000, true, [step(1, 'passed')]);
    // Checkout: ผ่าน 1 พัง 2 (พังที่ step 2 และ 3)
    await run(checkout, ago(20 * H), 10_000, true, [step(1, 'passed')]);
    await run(checkout, ago(4 * H), 12_000, false, [step(1, 'passed'), step(2, 'failed', { error: 'ข้อความไม่ตรง' }), step(3, 'skipped')]);
    await run(checkout, ago(2 * H), 14_000, false, [step(1, 'passed'), step(2, 'passed'), step(3, 'failed', { error: 'หา element ไม่เจอ' })]);
    // อีกโปรเจกต์ และการรันเก่าเกินช่วง
    await run(other, ago(3 * H), 6000, true, [step(1, 'passed')]);
    await run(login, ago(40 * 24 * H), 99_999, false, [step(1, 'failed', { error: 'เก่ามาก' })]);
  });

  const range = { from: ago(24 * H), to: new Date(NOW) };

  it('ยอดรวมในช่วงเวลา: จำนวน ผ่าน/พัง เวลาเฉลี่ย (ไม่รวมการรันที่เก่าเกินช่วง)', async () => {
    const { totals } = await store.repos.stats.overview(range);
    // ใน 24 ชม.: login 2 (5h,1h), checkout 3 (20h,4h,2h), other 1 = 6 ครั้ง
    expect(totals).toMatchObject({ runs: 6, passed: 4, failed: 2 });
    expect(totals.avgMs).toBeCloseTo((3000 + 4000 + 10_000 + 12_000 + 14_000 + 6000) / 6, 0);
  });

  it('กรองตามโปรเจกต์', async () => {
    expect((await store.repos.stats.overview({ ...range, projectId: pA })).totals).toMatchObject({ runs: 5, passed: 3, failed: 2 });
    expect((await store.repos.stats.overview({ ...range, projectId: pB })).totals).toMatchObject({ runs: 1, passed: 1, failed: 0 });
  });

  it('ช่วงที่ไม่มีการรันได้ศูนย์ ไม่ใช่ error', async () => {
    const empty = await store.repos.stats.overview({ from: ago(400 * 24 * H), to: ago(399 * 24 * H) });
    expect(empty.totals).toEqual({ runs: 0, passed: 0, failed: 0, avgMs: 0, healedSteps: 0, pendingHeals: 0 });
    expect(empty.series).toEqual([]);
    expect(empty.slowest).toEqual([]);
  });

  it('กราฟรายช่วง: ผลรวมของทุกช่องเท่ากับยอดรวม และเรียงตามเวลา', async () => {
    const o = await store.repos.stats.overview(range);
    expect(o.bucketMs).toBe(30 * 60e3);
    expect(o.series.reduce((n, p) => n + p.passed + p.failed, 0)).toBe(6);
    expect(o.series.reduce((n, p) => n + p.failed, 0)).toBe(2);
    expect(o.series.map((p) => p.t)).toEqual([...o.series.map((p) => p.t)].sort((a, b) => a - b));
    for (const p of o.series) expect(p.t % o.bucketMs).toBe(0); // ตรงขอบช่อง
  });

  it('เทสที่ช้าที่สุด เรียงจากมากไปน้อยตามเวลาเฉลี่ย', async () => {
    const { slowest } = await store.repos.stats.overview({ ...range, projectId: pA });
    expect(slowest.map((s) => [s.name, Math.round(s.avgMs)])).toEqual([['Checkout', 12_000], ['Login', 3500]]);
  });

  it('นับ step ที่ซ่อมอัตโนมัติ และที่ยังรอยืนยัน (เฉพาะการรันล่าสุดของแต่ละเทส)', async () => {
    const o = await store.repos.stats.overview({ ...range, projectId: pA });
    expect(o.totals.healedSteps).toBe(1);
    expect(o.totals.pendingHeals).toBe(0); // การรันล่าสุดของ Login ไม่ต้องซ่อมแล้ว
    await store.repos.runs.create({ testId: login, startedAt: ago(10 * 60e3), durationMs: 3300, passed: true, results: [step(1, 'passed', { healed: healed(login, 1) })] });
    const after = await store.repos.stats.overview({ ...range, projectId: pA });
    expect(after.totals).toMatchObject({ healedSteps: 2, pendingHeals: 1 });
  });

  it('ความล้มเหลวล่าสุด บอก step ที่พังและข้อความ ใหม่สุดก่อน', async () => {
    const { failures } = await store.repos.stats.overview({ ...range, projectId: pA });
    expect(failures.slice(0, 2).map((f) => [f.testName, f.stepNumber, f.message])).toEqual([
      ['Checkout', 3, 'หา element ไม่เจอ'],
      ['Checkout', 2, 'ข้อความไม่ตรง'],
    ]);
  });

  it('state timeline: เก่า -> ใหม่ แยกผ่าน/พัง/ซ่อม ต่อเทส (ดูข้ามช่วงเวลา ไม่ถูกตัดตามช่วง)', async () => {
    const { timeline } = await store.repos.stats.overview({ ...range, projectId: pA });
    const byName = Object.fromEntries(timeline.map((t) => [t.name, t.states.join('')]));
    expect(byName.Checkout).toBe('pff');
    expect(byName.Login).toBe('fphph'); // 40 วันก่อนพัง, ผ่าน (30 ชม.), ซ่อม (5 ชม.), ผ่าน (1 ชม.), ซ่อม (10 นาที)
  });
});
