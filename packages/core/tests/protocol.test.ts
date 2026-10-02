import { describe, expect, it } from 'vitest';
import { ACTIONS, parseClientMessage, type ClientMessage } from '../src/index.js';

const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));

describe('parseClientMessage', () => {
  it('รับข้อความที่ถูกต้องทุกชนิดที่หน้าเว็บส่ง', () => {
    const valid: ClientMessage[] = [
      { type: 'openTest', id: 3 },
      { type: 'navigate', url: 'https://a.test/' },
      { type: 'mousedown', x: 100, y: 200.5, button: 'left' },
      { type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: -120 },
      { type: 'press', key: 'Control+a' },
      { type: 'text', text: 'ทดสอบ@ตัวอย่าง.ไทย' },
      { type: 'record', on: true },
      { type: 'mode', mode: 'pick' },
      { type: 'insertStep', action: 'click' },
      { type: 'updateStep', id: 4, step: { action: 'click' }, secretValue: 'x' },
      { type: 'moveStep', id: 1, to: 0 },
      { type: 'acceptHeal', testId: 2, stepId: 5, locator: { type: 'css', value: '#a' } },
      { type: 'aiGenerate', instruction: 'ล็อกอิน' },
      { type: 'aiAccept', indexes: [0, 2] },
      { type: 'run' },
      { type: 'export' },
    ];
    for (const m of valid) expect(parse(m), m.type).toEqual(m);
  });

  it('ปฏิเสธ JSON เสีย ข้อความที่ไม่รู้จัก และฟิลด์ผิดชนิด/เกินขนาด', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parse({ type: 'hack' })).toBeNull();
    expect(parse({})).toBeNull();
    expect(parse({ type: 'mousedown', x: 1, y: 2, button: 'back' })).toBeNull();
    expect(parse({ type: 'mousemove', x: -5, y: 2 })).toBeNull();
    expect(parse({ type: 'mousemove', x: 1e9, y: 2 })).toBeNull();
    expect(parse({ type: 'mousemove', x: 'a', y: 2 })).toBeNull();
    expect(parse({ type: 'openTest', id: '3' })).toBeNull();
    expect(parse({ type: 'openTest', id: 0 })).toBeNull();
    expect(parse({ type: 'mode', mode: 'evil' })).toBeNull();
    expect(parse({ type: 'insertStep', action: 'rm -rf' })).toBeNull();
    expect(parse({ type: 'navigate', url: 'x'.repeat(3000) })).toBeNull();
    expect(parse({ type: 'text', text: 'x'.repeat(10_001) })).toBeNull();
    expect(parse({ type: 'aiGenerate', instruction: 'x'.repeat(2001) })).toBeNull();
    expect(parse({ type: 'aiAccept', indexes: [-1] })).toBeNull();
  });

  it('ตัด field ส่วนเกินทิ้ง (ไม่ปล่อยให้ข้อมูลแปลกปลอมผ่านเข้า handler)', () => {
    expect(parse({ type: 'run', evil: '<script>', __proto__: { x: 1 } })).toEqual({ type: 'run' });
  });

  it('insertStep รับทุกชนิด step ที่มี', () => {
    for (const action of Object.keys(ACTIONS)) expect(parse({ type: 'insertStep', action })).not.toBeNull();
  });
});
