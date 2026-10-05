import { createCipher } from '@test-studio/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from '../src/index.js';
import { resetDb } from './helpers.js';

let store: Store;
let raw: ReturnType<typeof postgres>;
let projectId: number;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL!;
  store = openStore({ url, cipher: createCipher(null, { SECRET_KEY: 'test-key' }), max: 4 });
  raw = postgres(url, { max: 1, onnotice: () => {} });
});
beforeEach(async () => {
  await resetDb();
  projectId = await store.repos.projects.create('auto');
});
afterAll(async () => {
  await raw.end();
  await store.close();
});

describe('environments', () => {
  it('สร้าง แก้ หา และชื่อซ้ำในโปรเจกต์เดียวกันไม่ได้', async () => {
    const id = await store.repos.environments.create(projectId, { name: 'staging', baseUrl: 'https://staging.a.test' });
    await expect(store.repos.environments.create(projectId, { name: 'staging', baseUrl: 'https://x.test' })).rejects.toThrow();
    await store.repos.environments.update(id, { baseUrl: 'https://stg.a.test' });
    expect(await store.repos.environments.findByName(projectId, 'staging')).toMatchObject({ id, baseUrl: 'https://stg.a.test' });
    expect(await store.repos.environments.list(projectId)).toHaveLength(1);
  });
});

describe('schedules', () => {
  it('คำนวณเวลาครั้งถัดไปตอนสร้าง และใส่คิวเฉพาะที่ถึงเวลา ครั้งเดียว', async () => {
    const envId = await store.repos.environments.create(projectId, { name: 'prod', baseUrl: 'https://a.test' });
    const t0 = new Date('2026-10-05T00:00:00Z');
    const every15 = await store.repos.schedules.create(projectId, { name: 'ทุก 15 นาที', target: { type: 'project' }, timing: { kind: 'interval', minutes: 15 }, environmentId: envId, enabled: true }, t0);
    await store.repos.schedules.create(projectId, { name: 'ปิดอยู่', target: { type: 'project' }, timing: { kind: 'interval', minutes: 15 }, environmentId: null, enabled: false }, t0);
    expect((await store.repos.schedules.get(every15))!.nextRunAt).toEqual(new Date('2026-10-05T00:15:00Z'));

    expect(await store.repos.schedules.enqueueDue(new Date('2026-10-05T00:10:00Z'))).toEqual([]);
    const later = new Date('2026-10-05T03:00:00Z');
    // runner สองตัวเรียกพร้อมกัน: ได้งานเดียว ไม่ซ้ำ
    const [a, b] = await Promise.all([store.repos.schedules.enqueueDue(later), store.repos.schedules.enqueueDue(later)]);
    expect([...a, ...b]).toHaveLength(1);
    const batch = (await store.repos.batches.get([...a, ...b][0]!))!;
    expect(batch).toMatchObject({ trigger: 'schedule', label: 'ทุก 15 นาที', scheduleId: every15, environmentId: envId, environmentName: 'prod', status: 'queued' });
    // ปิดเครื่องไปนาน: นับรอบถัดไปจากตอนนี้ ไม่รันย้อนหลังรัวๆ
    expect((await store.repos.schedules.get(every15))!.nextRunAt).toEqual(new Date('2026-10-05T03:15:00Z'));
    expect(await store.repos.schedules.enqueueDue(later)).toEqual([]);
  });

  it('ตารางเวลาที่รูปแบบผิดไม่เข้าฐานข้อมูล', async () => {
    await expect(store.repos.schedules.create(projectId, { name: 'x', target: { type: 'project' }, timing: { kind: 'interval', minutes: 5 }, environmentId: null, enabled: true })).rejects.toThrow('15 นาที');
    await expect(store.repos.schedules.create(projectId, { name: 'x', target: { type: 'test', id: -1 } as never, timing: { kind: 'interval', minutes: 15 }, environmentId: null, enabled: true })).rejects.toThrow();
  });
});

describe('notification channels', () => {
  it('เก็บ config แบบเข้ารหัส หน้าเว็บเห็นแค่ปลายทางแบบย่อ', async () => {
    const url = 'https://hooks.slack.com/services/T000/B000/abcdefSECRET1234';
    const id = await store.repos.channels.create(projectId, { name: 'ทีม QA', config: { type: 'slack', url }, notifyOn: 'problems' });
    const [stored] = await raw`select config from notification_channels where id = ${id}`;
    expect(stored!.config).not.toContain('hooks.slack.com');
    const [summary] = await store.repos.channels.list(projectId);
    expect(summary).toEqual({ id, projectId, name: 'ทีม QA', type: 'slack', notifyOn: 'problems', enabled: true, destination: 'hooks.slack.com/…1234' });
    expect(JSON.stringify(summary)).not.toContain('SECRET');
    expect((await store.repos.channels.get(id))!.config).toEqual({ type: 'slack', url });

    await store.repos.channels.update(id, { enabled: false });
    expect(await store.repos.channels.enabledFor(projectId)).toEqual([]);
    await expect(store.repos.channels.create(projectId, { name: 'x', config: { type: 'slack', url: 'http://insecure.test' }, notifyOn: 'always' })).rejects.toThrow('https');
  });
});

describe('api tokens', () => {
  it('คืน token จริงครั้งเดียว เก็บแค่ hash และบันทึกเวลาใช้ล่าสุด', async () => {
    const { id, token } = await store.repos.tokens.create(projectId, 'GitHub Actions');
    expect(token).toMatch(/^tsk_[\w-]{43}$/);
    const [row] = await raw`select token_hash, prefix from api_tokens where id = ${id}`;
    expect(row!.token_hash).not.toContain(token.slice(4, 20));
    expect(row!.prefix).toBe(token.slice(0, 10));
    expect(await store.repos.tokens.verify(token)).toEqual({ id, projectId });
    expect((await store.repos.tokens.get(id))!.lastUsedAt).not.toBeNull();
    expect(await store.repos.tokens.verify(`${token}x`)).toBeNull();
    expect(await store.repos.tokens.verify('not-a-token')).toBeNull();
    await store.repos.tokens.remove(id);
    expect(await store.repos.tokens.verify(token)).toBeNull();
  });
});

describe('run batches', () => {
  it('runner หลายตัวหยิบงานจากคิวพร้อมกัน แต่ละงานถูกหยิบครั้งเดียว', async () => {
    const ids = await Promise.all([1, 2, 3].map((i) => store.repos.batches.enqueue({ projectId, target: { type: 'project' }, trigger: 'api', label: `api ${i}` })));
    const claimed = await Promise.all([1, 2, 3, 4].map(() => store.repos.batches.claimNext()));
    expect(claimed.filter(Boolean).map((b) => b!.id).sort()).toEqual([...ids].sort());
    expect(claimed.filter((b) => b == null)).toHaveLength(1);
    expect(claimed.find(Boolean)).toMatchObject({ status: 'running' });
  });

  it('รอบก่อนหน้าของแหล่งเดียวกัน และปิดงานที่ค้างเมื่อ runner ดับ', async () => {
    const target = { type: 'test', id: 99 } as const;
    const first = await store.repos.batches.enqueue({ projectId, target, trigger: 'api', label: 'CI' });
    await store.repos.batches.claimNext();
    await store.repos.batches.finish(first, { total: 3, failed: 1 });
    await store.repos.batches.enqueue({ projectId, target: { type: 'project' }, trigger: 'api', label: 'อื่น' });
    const second = await store.repos.batches.enqueue({ projectId, target, trigger: 'api', label: 'CI' });
    expect((await store.repos.batches.previousFinished((await store.repos.batches.get(second))!))!).toMatchObject({ id: first, failed: 1, status: 'done' });

    const stuck = await store.repos.batches.enqueue({ projectId, target, trigger: 'manual', label: 'ค้าง' });
    await raw`update run_batches set status = 'running', started_at = now() - interval '2 hours' where id = ${stuck}`;
    expect(await store.repos.batches.failStale(60 * 60_000)).toBe(1);
    expect(await store.repos.batches.get(stuck)).toMatchObject({ status: 'error', error: 'runner หยุดทำงานระหว่างรัน' });

    const page = await store.repos.batches.list(projectId, { limit: 2, offset: 0 });
    expect(page.total).toBe(4);
    expect(page.items.map((b) => b.id)).toEqual([stuck, second]);
  });
});
