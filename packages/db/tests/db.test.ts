import { createCipher, type RunStepResult, type Step } from '@test-studio/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStore, seedIfEmpty, type Store } from '../src/index.js';

let store: Store;
let raw: ReturnType<typeof postgres>;
const login: Step[] = [
  { id: 1, action: 'goto', value: 'https://a.test/' },
  { id: 2, action: 'fill', locator: { type: 'label', value: 'รหัสผ่าน' }, secret: 'PW' },
];
const result = (stepId: number, status: RunStepResult['status'], extra: Partial<RunStepResult> = {}): RunStepResult => ({ stepId, label: `step ${stepId}`, status, ms: 5, ...extra });

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL!;
  store = openStore({ url, cipher: createCipher(null, { SECRET_KEY: 'test-key' }) });
  raw = postgres(url, { max: 1 });
});
afterAll(async () => {
  await raw.end();
  await store.close();
});

describe('projects และ tests', () => {
  it('seedIfEmpty ใส่ข้อมูลตัวอย่างครั้งเดียว', async () => {
    await seedIfEmpty(store.repos);
    await seedIfEmpty(store.repos);
    const projects = await store.repos.projects.list();
    expect(projects.map((p) => p.name)).toEqual(['โปรเจกต์ตัวอย่าง']);
    expect((await store.repos.tests.list(projects[0]!.id)).map((t) => [t.name, t.stepCount, t.lastPassed])).toEqual([['Login Test', 0, null]]);
  });

  it('เก็บและอ่าน step กลับมาตรงเดิม รวมภาษาไทยและลายนิ้วมือ', async () => {
    const projectId = await store.repos.projects.create('Shop');
    const id = await store.repos.tests.create(projectId, 'ล็อกอินด้วยอีเมล');
    const steps: Step[] = [
      ...login,
      {
        id: 3,
        action: 'click',
        locator: { type: 'role', role: 'button', name: 'เข้าสู่ระบบ' },
        fallbacks: [{ type: 'css', value: '#go' }],
        fingerprint: { tag: 'button', id: 'go', type: null, text: 'เข้าสู่ระบบ' },
      },
    ];
    await store.repos.tests.saveSteps(id, steps);
    const got = await store.repos.tests.get(id);
    expect(got?.steps).toEqual(steps);
    expect(got).toMatchObject({ projectId, name: 'ล็อกอินด้วยอีเมล' });
    expect((await store.repos.tests.list(projectId))[0]).toMatchObject({ stepCount: 3, lastPassed: null });
  });

  it('ไม่เก็บ step ที่ผิดรูปแบบ และของเดิมไม่ถูกแตะ', async () => {
    const projectId = (await store.repos.projects.list())[0]!.id;
    const id = await store.repos.tests.create(projectId, 'guard');
    await store.repos.tests.saveSteps(id, login);
    await expect(store.repos.tests.saveSteps(id, [{ action: 'click' }])).rejects.toThrow();
    await expect(store.repos.tests.saveSteps(id, [{ action: 'fill', locator: null, secret: 'lowercase' }])).rejects.toThrow();
    expect((await store.repos.tests.get(id))?.steps).toEqual(login);
  });

  it('เปลี่ยนชื่อ อัปเดตเวลาแก้ไข และคืน null เมื่อไม่พบ', async () => {
    const projectId = (await store.repos.projects.list())[0]!.id;
    const id = await store.repos.tests.create(projectId, 'เก่า');
    const before = (await store.repos.tests.get(id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 15));
    await store.repos.tests.rename(id, 'ใหม่');
    const after = (await store.repos.tests.get(id))!;
    expect(after.name).toBe('ใหม่');
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(await store.repos.tests.get(999999)).toBeNull();
  });

  it('ลบโปรเจกต์แล้วเทส ตัวแปรลับ และประวัติการรันถูกลบตาม (cascade)', async () => {
    const projectId = await store.repos.projects.create('ลบทิ้ง');
    const testId = await store.repos.tests.create(projectId, 't');
    await store.repos.secrets.set(projectId, 'PW', 'x');
    await store.repos.runs.create({ testId, startedAt: new Date(), durationMs: 1, passed: true, results: [] });
    await store.repos.projects.remove(projectId);
    expect(await store.repos.tests.get(testId)).toBeNull();
    expect(await store.repos.secrets.names(projectId)).toEqual([]);
    expect(await store.repos.runs.list(testId)).toEqual([]);
  });
});

describe('secrets', () => {
  it('เก็บแบบเข้ารหัส (ในตารางไม่มีค่าจริง) และถอดรหัสได้เฉพาะผ่าน values()', async () => {
    const projectId = await store.repos.projects.create('secrets');
    await store.repos.secrets.set(projectId, 'ADMIN_PW', 'hunter2-สวัสดี');
    const [row] = await raw`select value from secrets where project_id = ${projectId} and name = 'ADMIN_PW'`;
    expect(row!.value).toMatch(/^enc:v1:/);
    expect(row!.value).not.toContain('hunter2');
    expect(await store.repos.secrets.values(projectId)).toEqual({ ADMIN_PW: 'hunter2-สวัสดี' });
    expect(await store.repos.secrets.names(projectId)).toEqual(['ADMIN_PW']);
  });

  it('ตั้งค่าซ้ำชื่อเดิมคือเปลี่ยนค่า และลบได้', async () => {
    const projectId = await store.repos.projects.create('secrets2');
    await store.repos.secrets.set(projectId, 'A', '1');
    await store.repos.secrets.set(projectId, 'A', '2');
    await store.repos.secrets.set(projectId, 'B', '3');
    expect(await store.repos.secrets.values(projectId)).toEqual({ A: '2', B: '3' });
    await store.repos.secrets.remove(projectId, 'A');
    expect(await store.repos.secrets.names(projectId)).toEqual(['B']);
  });

  it('เปลี่ยน SECRET_KEY แล้วค่าเดิมถอดไม่ได้ จึงถือว่ายังไม่ตั้งค่า (ไม่พังทั้งระบบ)', async () => {
    const projectId = await store.repos.projects.create('secrets3');
    await store.repos.secrets.set(projectId, 'OLD', 'v');
    const other = openStore({ url: process.env.TEST_DATABASE_URL, cipher: createCipher(null, { SECRET_KEY: 'another' }), max: 1 });
    try {
      const warn = console.warn;
      console.warn = () => {};
      try {
        expect(await other.repos.secrets.values(projectId)).toEqual({});
      } finally {
        console.warn = warn;
      }
      expect(await other.repos.secrets.names(projectId)).toEqual(['OLD']);
    } finally {
      await other.close();
    }
  });
});

describe('runs', () => {
  it('เก็บผลรัน ประวัติเรียงใหม่สุดก่อน และ screenshot ดึงแยกได้', async () => {
    const projectId = await store.repos.projects.create('runs');
    const testId = await store.repos.tests.create(projectId, 'r');
    const shot = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const first = await store.repos.runs.create({ testId, startedAt: new Date('2026-10-01T10:00:00Z'), durationMs: 120, passed: true, results: [result(1, 'passed')] });
    const second = await store.repos.runs.create({
      testId,
      startedAt: new Date('2026-10-01T11:00:00Z'),
      durationMs: 5300,
      passed: false,
      results: [result(1, 'passed'), result(2, 'failed', { error: 'ข้อความไม่ตรง' }), result(3, 'skipped', { ms: undefined })],
      screenshot: shot,
    });
    const list = await store.repos.runs.list(testId);
    expect(list.map((r) => [r.id, r.passed, r.hasScreenshot])).toEqual([[second, false, true], [first, true, false]]);

    const detail = await store.repos.runs.get(second);
    expect(detail?.results.map((r) => r.status)).toEqual(['passed', 'failed', 'skipped']);
    expect(detail?.results[1]?.error).toBe('ข้อความไม่ตรง');
    expect(await store.repos.runs.screenshot(second)).toEqual(shot);
    expect(await store.repos.runs.screenshot(first)).toBeNull();
    expect(await store.repos.runs.get(999999)).toBeNull();
    // ผลรันล่าสุดสะท้อนในรายการเทส
    expect((await store.repos.tests.list(projectId))[0]?.lastPassed).toBe(false);
  });

  it('เก็บข้อมูล healed และไม่รับผลรันที่รูปแบบผิด', async () => {
    const projectId = await store.repos.projects.create('runs2');
    const testId = await store.repos.tests.create(projectId, 'h');
    const healed = [{ testId, stepId: 2, locator: { type: 'css' as const, value: '#go' }, label: 'คลิก ปุ่ม' }];
    const id = await store.repos.runs.create({ testId, startedAt: new Date(), durationMs: 3300, passed: true, results: [result(2, 'passed', { healed })] });
    expect((await store.repos.runs.get(id))?.results[0]?.healed).toEqual(healed);
    await expect(store.repos.runs.create({ testId, startedAt: new Date(), durationMs: 1, passed: true, results: [{ stepId: 1, label: 'x', status: 'weird' } as never] })).rejects.toThrow();
  });

  it('recentResults คืนตามจำนวนที่ขอ ใหม่สุดก่อน', async () => {
    const projectId = await store.repos.projects.create('runs3');
    const testId = await store.repos.tests.create(projectId, 'rr');
    for (let i = 1; i <= 5; i++) {
      await store.repos.runs.create({ testId, startedAt: new Date(), durationMs: i, passed: true, results: [result(i, 'passed')] });
    }
    const recent = await store.repos.runs.recentResults(testId, 3);
    expect(recent.map((r) => r[0]?.stepId)).toEqual([5, 4, 3]);
  });

  it('ประวัติแสดงสูงสุด 50 รายการ', async () => {
    const projectId = await store.repos.projects.create('runs4');
    const testId = await store.repos.tests.create(projectId, 'many');
    await Promise.all(Array.from({ length: 55 }, () => store.repos.runs.create({ testId, startedAt: new Date(), durationMs: 1, passed: true, results: [] })));
    expect(await store.repos.runs.list(testId)).toHaveLength(50);
  });
});
