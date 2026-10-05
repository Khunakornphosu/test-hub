import { describe, expect, it } from 'vitest';
import { createUrlGuard, describeTiming, flowPaths, formatNotice, nextRunAt, postJson, rebaseUrl, scheduleTimingSchema, sendNotice, shouldNotify, type BatchNotice } from '../src/index.js';

describe('nextRunAt', () => {
  it('ทุก N นาทีนับจากเวลาที่ให้', () => {
    expect(nextRunAt({ kind: 'interval', minutes: 30 }, new Date('2026-10-05T01:00:00Z'))).toEqual(new Date('2026-10-05T01:30:00Z'));
  });

  it('รายวันตามเวลาไทย (UTC+7) และข้ามวันที่ไม่ได้เลือก', () => {
    const weekdays8am = { kind: 'daily' as const, time: '08:00', days: [1, 2, 3, 4, 5], timezone: 'Asia/Bangkok' };
    // จันทร์ 5 ต.ค. 2026 07:00 น. ไทย -> 08:00 วันเดียวกัน = 01:00Z
    expect(nextRunAt(weekdays8am, new Date('2026-10-05T00:00:00Z'))).toEqual(new Date('2026-10-05T01:00:00Z'));
    // ตรงเวลาพอดีไม่นับ ไปวันถัดไป
    expect(nextRunAt(weekdays8am, new Date('2026-10-05T01:00:00Z'))).toEqual(new Date('2026-10-06T01:00:00Z'));
    // ศุกร์ 9 ต.ค. หลัง 8 โมง -> จันทร์ 12 ต.ค.
    expect(nextRunAt(weekdays8am, new Date('2026-10-09T05:00:00Z'))).toEqual(new Date('2026-10-12T01:00:00Z'));
    // เที่ยงคืนไทย = 17:00Z ของวันก่อน
    expect(nextRunAt({ kind: 'daily', time: '00:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'Asia/Bangkok' }, new Date('2026-10-05T10:00:00Z'))).toEqual(new Date('2026-10-05T17:00:00Z'));
  });

  it('เขตเวลาที่มี DST ใช้ offset ของวันนั้นจริง', () => {
    const ny = { kind: 'daily' as const, time: '09:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'America/New_York' };
    expect(nextRunAt(ny, new Date('2026-07-01T00:00:00Z'))).toEqual(new Date('2026-07-01T13:00:00Z')); // EDT -4
    expect(nextRunAt(ny, new Date('2026-12-01T00:00:00Z'))).toEqual(new Date('2026-12-01T14:00:00Z')); // EST -5
  });

  it('ตรวจรูปแบบและอธิบายเป็นภาษาไทย', () => {
    expect(() => scheduleTimingSchema.parse({ kind: 'interval', minutes: 5 })).toThrow('15 นาที');
    expect(() => scheduleTimingSchema.parse({ kind: 'daily', time: '25:00', days: [1] })).toThrow('HH:MM');
    expect(() => scheduleTimingSchema.parse({ kind: 'daily', time: '08:00', days: [] })).toThrow('อย่างน้อย 1 วัน');
    expect(scheduleTimingSchema.parse({ kind: 'daily', time: '08:00', days: [1] })).toMatchObject({ timezone: 'Asia/Bangkok' });
    expect(describeTiming({ kind: 'interval', minutes: 30 })).toBe('ทุก 30 นาที');
    expect(describeTiming({ kind: 'interval', minutes: 120 })).toBe('ทุก 2 ชั่วโมง');
    expect(describeTiming({ kind: 'daily', time: '08:00', days: [5, 1, 2, 3, 4], timezone: 'Asia/Bangkok' })).toBe('จ.–ศ. 08:00');
    expect(describeTiming({ kind: 'daily', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'Asia/Bangkok' })).toBe('ทุกวัน 21:30');
    expect(describeTiming({ kind: 'daily', time: '07:00', days: [1, 3], timezone: 'Asia/Bangkok' })).toBe('จ. พ. 07:00');
  });
});

describe('rebaseUrl', () => {
  it('เปลี่ยนโดเมนตาม environment แต่เก็บ path/query/hash', () => {
    expect(rebaseUrl('https://prod.a.test/login?x=1#top', 'https://staging.a.test')).toBe('https://staging.a.test/login?x=1#top');
    expect(rebaseUrl('https://prod.a.test/shop/cart', 'http://localhost:3000/base/')).toBe('http://localhost:3000/base/shop/cart');
    expect(rebaseUrl('not a url', 'https://a.test')).toBe('not a url');
  });
});

describe('แจ้งเตือน', () => {
  const notice: BatchNotice = { projectName: 'ร้านค้า', label: 'ทุกเช้า', trigger: 'schedule', environmentName: 'staging', total: 10, failed: 2, durationMs: 83_000, failures: [{ testName: 'Login', error: 'หา element ไม่เจอ' }, { testName: 'ชำระเงิน', error: 'URL ไม่ตรง' }], url: 'https://ts.test/runs?batch=7' };

  it('ข้อความภาษาไทยสรุปผล ระบุเทสที่พัง และลิงก์', () => {
    expect(formatNotice(notice)).toBe(['[ไม่ผ่าน] ร้านค้า · ทุกเช้า (ตั้งเวลา)', 'ผ่าน 8/10 · staging · 1 นาที 23 วินาที', '- Login: หา element ไม่เจอ', '- ชำระเงิน: URL ไม่ตรง', 'ดูผล: https://ts.test/runs?batch=7'].join('\n'));
    expect(formatNotice({ ...notice, failed: 0, failures: [], recovered: true, environmentName: null })).toMatch(/^\[กลับมาผ่าน\] .*\nผ่าน 10\/10 · 1 นาที 23 วินาที\n/);
    expect(formatNotice({ ...notice, error: 'ไม่พบเทสในโปรเจกต์', failures: [] })).toMatch(/^\[รันไม่ได้\] .*\nไม่พบเทสในโปรเจกต์/);
    const many = { ...notice, failed: 7, failures: Array.from({ length: 7 }, (_, i) => ({ testName: `t${i}`, error: 'x' })) };
    expect(formatNotice(many)).toContain('- และอีก 2 เทส');
  });

  it('problems: แจ้งเมื่อไม่ผ่าน และครั้งแรกที่กลับมาผ่าน', () => {
    expect(shouldNotify('problems', false, null)).toBe(true);
    expect(shouldNotify('problems', true, false)).toBe(true);
    expect(shouldNotify('problems', true, true)).toBe(false);
    expect(shouldNotify('problems', true, null)).toBe(false);
    expect(shouldNotify('always', true, true)).toBe(true);
  });

  it('ส่งไปที่อยู่ภายใน/ไม่ใช่ https ไม่ได้ (ปลายทางมาจากผู้ใช้)', async () => {
    const guard = createUrlGuard({ appPort: 4700, env: {} });
    await expect(postJson(guard, 'https://169.254.169.254/latest', {})).rejects.toThrow('เครือข่าย');
    await expect(postJson(guard, 'https://127.0.0.1:4800/healthz', {})).rejects.toThrow();
    await expect(postJson(guard, 'http://example.com/hook', {})).rejects.toThrow('https');
    await expect(sendNotice(guard, { type: 'webhook', url: 'https://10.0.0.5/hook' }, notice)).rejects.toThrow('เครือข่าย');
  });
});

describe('flowPaths', () => {
  it('ทุกเส้นทางจากต้นทางถึงปลายทาง และหยุดเมื่อครบ cap', () => {
    const nodes = ['a', 'b', 'c', 'd', 'x'].map((id) => ({ id }));
    const edges = [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'b', target: 'd' }, { source: 'c', target: 'd' }];
    expect(flowPaths(nodes, edges)).toEqual([['a', 'b', 'd'], ['a', 'c', 'd'], ['x']]);
    expect(flowPaths(nodes, edges, 2)).toHaveLength(2);
    expect(flowPaths([], [])).toEqual([]);
  });
});
