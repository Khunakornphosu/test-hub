import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  blankStep,
  describeParts,
  describeStep,
  exportJson,
  exportTest,
  fingerprintScore,
  isComplete,
  locatorToCode,
  sanitizeStep,
  stepSchema,
  stepToCode,
  testStepsSchema,
  type Step,
} from '../src/index.js';

describe('sanitizeStep', () => {
  it('ปฏิเสธประเภท step ที่ไม่รู้จักและค่าที่ไม่ใช่ object', () => {
    expect(() => sanitizeStep({ action: 'hack' })).toThrow('ไม่รู้จักประเภท step');
    expect(() => sanitizeStep(null)).toThrow('ไม่รู้จักประเภท step');
    expect(() => sanitizeStep('click')).toThrow('ไม่รู้จักประเภท step');
  });

  it('locator role ต้องมี role และตัด name ว่างทิ้ง', () => {
    expect(() => sanitizeStep({ action: 'click', locator: { type: 'role', role: ' ' } })).toThrow('กรุณาระบุ role');
    expect(() => sanitizeStep({ action: 'click', locator: { type: 'css', value: '  ' } })).toThrow('กรุณาระบุค่า locator');
    expect(() => sanitizeStep({ action: 'click', locator: { type: 'xpath', value: '//a' } })).toThrow('ไม่รู้จักประเภท locator');
    const step = sanitizeStep({ action: 'click', locator: { type: 'role', role: 'button', name: '  ' } });
    expect('locator' in step && step.locator).toEqual({ type: 'role', role: 'button' });
  });

  it('ชื่อตัวแปรลับต้องเป็น A-Z 0-9 _ และไม่เก็บค่าจริงใน step', () => {
    const base = { action: 'fill', locator: { type: 'label', value: 'x' } };
    expect(() => sanitizeStep({ ...base, secret: 'my pass' })).toThrow('ชื่อตัวแปรลับ');
    expect(sanitizeStep({ ...base, value: 'plain', secret: 'pw_1' })).toEqual({ action: 'fill', locator: { type: 'label', value: 'x' }, secret: 'PW_1' });
  });

  it('เก็บ fallbacks/fingerprint ที่ถูกต้อง และตัดตัวที่เสียทิ้ง', () => {
    const step = sanitizeStep({
      action: 'click',
      locator: { type: 'role', role: 'button', name: 'OK' },
      fallbacks: [{ type: 'css', value: '#ok' }, { type: 'bogus' }, { type: 'text', value: '' }],
      fingerprint: { tag: 'button', text: 'OK', evil: '<script>', type: null },
    });
    expect('fallbacks' in step && step.fallbacks).toEqual([{ type: 'css', value: '#ok' }]);
    expect('fingerprint' in step && step.fingerprint).toEqual({ tag: 'button', text: 'OK' });
  });

  it('จำกัด fallbacks ไม่เกิน 4 ตัว และตัดลายนิ้วมือยาวเกิน 100 ตัวอักษร', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ type: 'css', value: `#a${i}` }));
    const step = sanitizeStep({ action: 'click', locator: { type: 'css', value: '#x' }, fallbacks: many, fingerprint: { tag: 'a', text: 'x'.repeat(300) } });
    expect('fallbacks' in step && step.fallbacks).toHaveLength(4);
    expect('fingerprint' in step && step.fingerprint?.text).toHaveLength(100);
  });

  it('ไม่ใส่ fallbacks/fingerprint ถ้ายังไม่ได้เลือก element หรือไม่มี tag', () => {
    const noLocator = sanitizeStep({ action: 'click', fallbacks: [{ type: 'css', value: '#a' }], fingerprint: { tag: 'a' } });
    expect(noLocator).toEqual({ action: 'click', locator: null });
    const noTag = sanitizeStep({ action: 'click', locator: { type: 'css', value: '#a' }, fingerprint: { text: 'x' } });
    expect('fingerprint' in noTag).toBe(false);
  });

  it('assertCount ต้องเป็นตัวเลข และ useTest รับเฉพาะ id ที่เป็นจำนวนเต็มบวก', () => {
    expect(() => sanitizeStep({ action: 'assertCount', locator: { type: 'css', value: 'li' }, expected: 'สาม' })).toThrow('จำนวนต้องเป็นตัวเลข');
    expect(sanitizeStep({ action: 'useTest', testId: 'abc' })).toEqual({ action: 'useTest', testId: null });
    expect(sanitizeStep({ action: 'useTest', testId: '7' })).toEqual({ action: 'useTest', testId: 7 });
    expect(sanitizeStep({ action: 'useTest', testId: -3 })).toEqual({ action: 'useTest', testId: null });
  });

  it('ผลลัพธ์ผ่าน stepSchema เสมอ และ blankStep ได้ step ที่ยังไม่สมบูรณ์', () => {
    for (const action of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
      const step = blankStep(action);
      expect(stepSchema.safeParse(step).success, action).toBe(true);
    }
    expect(isComplete(blankStep('click'))).toBe(false);
    expect(isComplete(blankStep('press'))).toBe(true);
    expect(isComplete(blankStep('goto'))).toBe(true);
    expect(isComplete(sanitizeStep({ action: 'useTest', testId: 3 }))).toBe(true);
  });

  it('fillForm: แปลง label เป็น locator, ตัดช่องเกิน 30 และ blankStep มีหนึ่งช่องว่าง', () => {
    const step = sanitizeStep({
      action: 'fillForm',
      fields: [
        { label: '  อีเมล  ', value: 'a@b.com' },
        { locator: { type: 'css', value: '#pw' }, value: 123 },
        { value: 'x' },
        'junk',
      ],
    });
    expect(step).toEqual({
      action: 'fillForm',
      fields: [
        { locator: { type: 'label', value: 'อีเมล' }, value: 'a@b.com' },
        { locator: { type: 'css', value: '#pw' }, value: '123' },
        { locator: null, value: 'x' },
        { locator: null, value: '' },
      ],
    });
    expect(() => sanitizeStep({ action: 'fillForm', fields: [{ locator: { type: 'css', value: ' ' } }] })).toThrow('กรุณาระบุค่า locator');
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `f${i}`, value: '' }));
    expect(sanitizeStep({ action: 'fillForm', fields: many })).toMatchObject({ fields: { length: 30 } });
    expect(sanitizeStep({ action: 'fillForm' })).toEqual({ action: 'fillForm', fields: [] });
    expect(blankStep('fillForm')).toEqual({ action: 'fillForm', fields: [{ locator: null, value: '' }] });
  });

  it('fillForm สมบูรณ์เมื่อมีอย่างน้อยหนึ่งช่องและทุกช่องมี locator หรือ label', () => {
    expect(isComplete(blankStep('fillForm'))).toBe(false);
    expect(isComplete({ action: 'fillForm', fields: [] })).toBe(false);
    expect(isComplete({ action: 'fillForm', fields: [{ label: 'อีเมล', value: '' }] })).toBe(true);
    expect(isComplete({ action: 'fillForm', fields: [{ label: '  ', value: '' }] })).toBe(false);
    expect(isComplete({ action: 'fillForm', fields: [{ locator: { type: 'css', value: '#a' }, value: '' }, { locator: null, value: '' }] })).toBe(false);
  });
});

describe('stepSchema (ตรวจข้อมูลที่เก็บในฐานข้อมูล)', () => {
  it('รับ step ที่ recorder บันทึกไว้ รวมลายนิ้วมือที่มีค่า null', () => {
    const stored = {
      id: 3,
      action: 'fill',
      locator: { type: 'role', role: 'textbox', name: 'อีเมล' },
      fallbacks: [{ type: 'label', value: 'อีเมล' }],
      fingerprint: { tag: 'input', type: null, id: 'email', name: 'email', role: null, ariaLabel: null, placeholder: 'you@x.com', testId: null, text: null },
      value: 'a@b.com',
    };
    expect(stepSchema.safeParse(stored).success).toBe(true);
    expect(testStepsSchema.safeParse([stored, { action: 'goto', value: 'https://a.test/' }]).success).toBe(true);
  });

  it('ปฏิเสธข้อมูลที่รูปแบบผิด', () => {
    expect(stepSchema.safeParse({ action: 'click' }).success).toBe(false); // ไม่มี locator
    expect(stepSchema.safeParse({ action: 'fill', locator: null, secret: 'lowercase' }).success).toBe(false);
    expect(stepSchema.safeParse({ action: 'assertCount', locator: null, expected: 'x' }).success).toBe(false);
    expect(stepSchema.safeParse({ action: 'useTest', testId: 0 }).success).toBe(false);
    expect(stepSchema.safeParse({ action: 'fillForm', fields: [{ locator: null }] }).success).toBe(false); // ไม่มี value
    expect(stepSchema.safeParse({ action: 'fillForm', fields: Array.from({ length: 31 }, () => ({ value: '' })) }).success).toBe(false);
  });
});

describe('codegen', () => {
  const login: Step[] = [{ action: 'goto', value: 'https://a.test/' }, { action: 'useTest', testId: 2 }];
  const checkout: Step[] = [{ action: 'useTest', testId: 1 }, { action: 'assertURL', expected: 'https://a.test/done' }];
  const resolve = (id: number) => ({ 1: { id: 1, name: 'Login', steps: login }, 2: { id: 2, name: 'Checkout', steps: checkout } })[id as 1 | 2];

  it('ขยาย block เป็น test.step และหยุดเมื่อวนกลับมาที่เทสต้นทาง', () => {
    const code = exportTest('Login', login, resolve, 1);
    expect(code).toContain("await test.step('Checkout', async () => {");
    expect(code).toContain('"Login" วนกลับมาเรียกตัวเอง');
    expect(code.match(/test\.step\(/g)).toHaveLength(1);
  });

  it('block ที่ถูกลบไปแล้วออกเป็นคอมเมนต์ ไม่พัง', () => {
    expect(exportTest('T', [{ action: 'useTest', testId: 9 }])).toContain('ไม่พบเทส #9');
  });

  it('ระบุ environment variable ของตัวแปรลับไว้ในโค้ด', () => {
    const code = exportTest('T', [{ action: 'fill', locator: { type: 'label', value: 'pw' }, secret: 'ADMIN_PW' }]);
    expect(code).toContain("process.env.ADMIN_PW ?? ''");
    expect(code).toContain('ต้องตั้งค่า environment variable ก่อนรัน: ADMIN_PW');
  });

  it('escape ข้อความที่มี quote และขึ้นบรรทัดใหม่', () => {
    expect(stepToCode({ action: 'fill', locator: { type: 'label', value: "it's" }, value: 'a\nb' })).toBe(
      "await page.getByLabel('it\\'s', { exact: true }).fill('a\\nb');"
    );
  });

  it('ทุกชนิด locator แปลงเป็นโค้ดที่ถูกต้อง', () => {
    expect(locatorToCode({ type: 'role', role: 'button', name: 'OK' })).toBe("page.getByRole('button', { name: 'OK', exact: true })");
    expect(locatorToCode({ type: 'role', role: 'banner' })).toBe("page.getByRole('banner')");
    expect(locatorToCode({ type: 'testid', value: 'x' })).toBe("page.getByTestId('x')");
    expect(locatorToCode({ type: 'css', value: '#a > b' })).toBe("page.locator('#a > b')");
  });

  it('exportJson ไม่ใส่ id และไม่มีค่าลับ', () => {
    const json = JSON.parse(exportJson('T', [{ id: 5, action: 'fill', locator: { type: 'label', value: 'pw' }, secret: 'PW' }]));
    expect(json).toEqual({ name: 'T', steps: [{ action: 'fill', locator: { type: 'label', value: 'pw' }, secret: 'PW' }] });
  });

  it('step ที่ยังไม่สมบูรณ์เป็น TODO', () => {
    expect(stepToCode(blankStep('click'))).toContain('TODO');
    expect(stepToCode(blankStep('useTest'))).toContain('TODO');
    expect(stepToCode(blankStep('fillForm'))).toBe('// TODO: กรอกฟอร์มหลายช่อง — กรุณาเลือก element ของทุกช่อง');
  });

  it('fillForm สร้าง .fill() หนึ่งบรรทัดต่อช่อง และใช้ label เมื่อไม่มี locator', () => {
    const code = stepToCode({
      action: 'fillForm',
      fields: [
        { locator: { type: 'css', value: '#email' }, value: 'a@b.com' },
        { label: ' ชื่อ ', value: "O'Neil" },
      ],
    });
    expect(code).toBe("await page.locator('#email').fill('a@b.com');\nawait page.getByLabel('ชื่อ', { exact: true }).fill('O\\'Neil');");
    const exported = exportTest('T', [{ action: 'fillForm', fields: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] }]);
    expect(exported).toContain("  await page.getByLabel('a', { exact: true }).fill('1');\n  await page.getByLabel('b', { exact: true }).fill('2');");
  });
});

describe('describe', () => {
  it('อธิบาย step เป็นภาษาคน', () => {
    expect(describeStep({ action: 'click', locator: { type: 'role', role: 'button', name: 'เข้าสู่ระบบ' } })).toBe('คลิก ปุ่ม "เข้าสู่ระบบ"');
    expect(describeStep({ action: 'fill', locator: { type: 'label', value: 'รหัสผ่าน' }, secret: 'PW' })).toBe('พิมพ์ ช่อง "รหัสผ่าน" •••••• (PW)');
    expect(describeStep({ action: 'selectOption', locator: { type: 'role', role: 'combobox', name: 'บทบาท' }, value: 'dev', label: 'Developer' })).toBe('เลือก dropdown "บทบาท" "Developer"');
    expect(describeStep(blankStep('click'))).toBe('คลิก (ยังไม่ได้เลือก element)');
    expect(describeParts({ action: 'fillForm', fields: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] })).toMatchObject({ verb: 'กรอกฟอร์ม', value: '2 ช่อง' });
  });

  it('step useTest แสดงชื่อและจำนวน step ของเทสที่ใช้ซ้ำ', () => {
    const ctx = { testName: (id: number) => (id === 2 ? 'Login' : undefined), testStepCount: () => 5 };
    expect(describeParts({ action: 'useTest', testId: 2 }, ctx)).toMatchObject({ verb: 'ใช้ซ้ำ', target: { text: 'Login', block: true }, value: '(5 steps)' });
    expect(describeParts({ action: 'useTest', testId: 9 }, ctx).missingTarget).toBe('ไม่พบเทส (อาจถูกลบไปแล้ว)');
    expect(describeParts({ action: 'useTest', testId: null }, ctx).missingTarget).toBe('ยังไม่ได้เลือกเทส');
  });
});

describe('fingerprintScore', () => {
  it('tag ต้องตรง และคิดสัดส่วนคุณสมบัติที่ตรงกัน', () => {
    const rec = { tag: 'button', type: 'submit', text: 'เข้าสู่ระบบ' };
    expect(fingerprintScore(rec, { tag: 'button', type: 'submit', text: 'เข้าสู่ระบบ' })).toBe(1);
    expect(fingerprintScore(rec, { tag: 'button', type: 'submit', text: 'ลงชื่อเข้าใช้' })).toBe(0.5);
    expect(fingerprintScore(rec, { tag: 'a', type: 'submit', text: 'เข้าสู่ระบบ' })).toBe(0);
    expect(fingerprintScore({ tag: 'div' }, { tag: 'div' })).toBe(0);
    expect(fingerprintScore(null, { tag: 'div' })).toBe(0);
  });
});
