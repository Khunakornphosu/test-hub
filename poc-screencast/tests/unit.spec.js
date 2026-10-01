// เทสระดับฟังก์ชัน (ไม่ต้องเปิดเบราว์เซอร์)
import { test, expect } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { exportTest, fingerprintScore, isComplete, sanitizeStep, stepToCode } from '../steps.js';
import { generateSteps, redactSnapshot } from '../ai.js';
import { createAccessControl, createCipher, createUrlGuard } from '../security.js';

test.describe('sanitizeStep', () => {
  test('ปฏิเสธประเภท step ที่ไม่รู้จัก', () => {
    expect(() => sanitizeStep({ action: 'hack' })).toThrow('ไม่รู้จักประเภท step');
  });

  test('locator role ต้องมี role และตัด name ว่างทิ้ง', () => {
    expect(() => sanitizeStep({ action: 'click', locator: { type: 'role', role: ' ' } })).toThrow('กรุณาระบุ role');
    expect(sanitizeStep({ action: 'click', locator: { type: 'role', role: 'button', name: '  ' } }).locator).toEqual({
      type: 'role',
      role: 'button',
    });
  });

  test('ชื่อตัวแปรลับต้องเป็น A-Z 0-9 _ และไม่เก็บค่าจริงใน step', () => {
    expect(() => sanitizeStep({ action: 'fill', locator: { type: 'label', value: 'x' }, secret: 'my pass' })).toThrow();
    const step = sanitizeStep({ action: 'fill', locator: { type: 'label', value: 'x' }, value: 'plain', secret: 'pw_1' });
    expect(step).toEqual({ action: 'fill', locator: { type: 'label', value: 'x' }, secret: 'PW_1' });
  });

  test('เก็บ fallbacks/fingerprint ที่ถูกต้อง และตัดตัวที่เสียทิ้ง', () => {
    const step = sanitizeStep({
      action: 'click',
      locator: { type: 'role', role: 'button', name: 'OK' },
      fallbacks: [{ type: 'css', value: '#ok' }, { type: 'bogus' }, { type: 'text', value: '' }],
      fingerprint: { tag: 'button', text: 'OK', evil: '<script>' },
    });
    expect(step.fallbacks).toEqual([{ type: 'css', value: '#ok' }]);
    expect(step.fingerprint).toEqual({ tag: 'button', text: 'OK' });
  });

  test('step ที่ยังไม่ได้เลือก element/เทส ถือว่ายังไม่สมบูรณ์', () => {
    expect(isComplete(sanitizeStep({ action: 'click' }))).toBe(false);
    expect(isComplete(sanitizeStep({ action: 'useTest', testId: 'abc' }))).toBe(false);
    expect(isComplete(sanitizeStep({ action: 'useTest', testId: 3 }))).toBe(true);
    expect(stepToCode(sanitizeStep({ action: 'click' }))).toContain('TODO');
  });
});

test.describe('exportTest', () => {
  const login = { id: 1, name: 'Login', steps: [{ action: 'goto', value: 'https://a.test/' }, { action: 'useTest', testId: 2 }] };
  const checkout = { id: 2, name: 'Checkout', steps: [{ action: 'useTest', testId: 1 }, { action: 'assertURL', expected: 'https://a.test/done' }] };
  const resolve = (id) => ({ 1: login, 2: checkout })[id];

  test('ขยาย block เป็น test.step และหยุดเมื่อวนกลับมาที่เทสต้นทาง', () => {
    const code = exportTest('Login', login.steps, resolve, 1);
    expect(code).toContain("await test.step('Checkout', async () => {");
    expect(code).toContain('"Login" วนกลับมาเรียกตัวเอง');
    expect(code.match(/test\.step\(/g)).toHaveLength(1);
  });

  test('ระบุ environment variable ของตัวแปรลับไว้ในโค้ด', () => {
    const code = exportTest('T', [{ action: 'fill', locator: { type: 'label', value: 'pw' }, secret: 'ADMIN_PW' }]);
    expect(code).toContain("process.env.ADMIN_PW ?? ''");
    expect(code).toContain('ต้องตั้งค่า environment variable ก่อนรัน: ADMIN_PW');
  });

  test('escape ข้อความที่มี quote และขึ้นบรรทัดใหม่', () => {
    const code = stepToCode({ action: 'fill', locator: { type: 'label', value: "it's" }, value: 'a\nb' });
    expect(code).toBe("await page.getByLabel('it\\'s', { exact: true }).fill('a\\nb');");
  });
});

test('fingerprintScore: tag ต้องตรง และคิดสัดส่วนคุณสมบัติที่ตรงกัน', () => {
  const rec = { tag: 'button', type: 'submit', text: 'เข้าสู่ระบบ' };
  expect(fingerprintScore(rec, { tag: 'button', type: 'submit', text: 'เข้าสู่ระบบ' })).toBe(1);
  expect(fingerprintScore(rec, { tag: 'button', type: 'submit', text: 'ลงชื่อเข้าใช้' })).toBe(0.5);
  expect(fingerprintScore(rec, { tag: 'a', type: 'submit', text: 'เข้าสู่ระบบ' })).toBe(0);
  expect(fingerprintScore({ tag: 'div' }, { tag: 'div' })).toBe(0);
});

test.describe('AI', () => {
  test('redactSnapshot ตัดค่าที่พิมพ์ไว้ทุกช่อง แต่เก็บ placeholder และตัวเลือก', () => {
    const snapshot = [
      '- textbox "อีเมล":',
      '  - /placeholder: you@example.com',
      '  - text: secret-email@x.com',
      '- textbox "รหัสผ่าน": pass1234',
      '- textbox "a: b" [disabled]: typed',
      '- combobox "บทบาท":',
      '  - option "Tester" [selected]',
      '- button "เข้าสู่ระบบ"',
    ].join('\n');
    const out = redactSnapshot(snapshot);
    expect(out).not.toContain('secret-email');
    expect(out).not.toContain('pass1234');
    expect(out).not.toContain('typed');
    expect(out).toContain('/placeholder: you@example.com');
    expect(out).toContain('option "Tester"');
    expect(out).toContain('button "เข้าสู่ระบบ"');
  });

  test('แปลงคำตอบของโมเดลเป็น step และตีตกเมื่อค่าที่จำเป็นหายไป', async () => {
    const result = {
      explanation: 'x',
      steps: [
        { action: 'goto', target: { by: 'none' }, url: 'https://a.test/' },
        { action: 'fill', target: { by: 'role', role: 'textbox', name: 'อีเมล' }, text: 'a@b.com' },
        { action: 'fill', target: { by: 'label', match: 'test@example.com' } },
        { action: 'fill', target: { by: 'label', match: 'รหัสผ่าน' }, secret: 'TEST_PASSWORD' },
        { action: 'click', target: { by: 'none' } },
        { action: 'assertText', target: { by: 'css', match: 'body' }, expected: '' },
      ],
    };
    const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
    const realFetch = globalThis.fetch;
    process.env.GEMINI_API_KEY = 'k';
    process.env.GEMINI_MODEL = 'm';
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }),
    });
    try {
      const { steps } = await generateSteps({ instruction: 'x', url: 'u', title: 't', snapshot: '', existingSteps: [] });
      expect(steps.map((s) => s.error ?? 'ok')).toEqual([
        'ok',
        'ok',
        'ไม่ได้ระบุข้อความที่จะพิมพ์',
        'ok',
        'ไม่ได้ระบุ element',
        'ไม่ได้ระบุข้อความที่ต้องตรวจ',
      ]);
      expect(steps[1].step).toEqual({ action: 'fill', locator: { type: 'role', role: 'textbox', name: 'อีเมล' }, value: 'a@b.com' });
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of [['GEMINI_API_KEY', saved.key], ['GEMINI_MODEL', saved.model]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

test.describe('createUrlGuard', () => {
  const guard = (env = {}) => createUrlGuard({ appPort: 3000, env });

  test('ค่าเริ่มต้น: กัน scheme อื่น, เครือข่ายภายใน, cloud metadata และ API ของระบบเอง', async () => {
    const g = guard();
    for (const url of [
      'file:///etc/passwd',
      'http://127.0.0.1:8080/',
      'http://localhost:5173/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.1.2.3/',
      'http://[::1]:8080/',
      'http://[::ffff:127.0.0.1]/',
      'http://localhost:3000/api/projects',
      'https://localhost:3000/demo-login.html',
    ]) {
      expect((await g.check(url)).ok, url).toBe(false);
    }
    expect((await g.check('http://localhost:3000/demo-login.html')).ok).toBe(true);
    expect((await g.check('http://93.184.215.14/')).ok).toBe(true);
  });

  test('ALLOWED_HOSTS อนุญาตเฉพาะโดเมนที่ระบุ (รองรับ *.)', async () => {
    const g = guard({ ALLOWED_HOSTS: 'staging.internal, *.example.com' });
    expect((await g.check('http://staging.internal/')).ok).toBe(true);
    expect((await g.check('https://a.example.com/')).ok).toBe(true);
    expect((await g.check('https://example.com/')).ok).toBe(true);
    expect((await g.check('https://evil.com/')).ok).toBe(false);
  });

  test('ALLOW_PRIVATE_NETWORK=true เปิดเครือข่ายภายในได้', async () => {
    expect((await guard({ ALLOW_PRIVATE_NETWORK: 'true' }).check('http://127.0.0.1:8080/')).ok).toBe(true);
  });
});

test('ตัวแปรลับ: เข้ารหัสแล้วถอดกลับได้ และจับได้ถ้าข้อมูลถูกแก้', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cipher-'));
  const env = process.env.SECRET_KEY;
  delete process.env.SECRET_KEY;
  try {
    const cipher = createCipher(dir);
    expect(fs.existsSync(path.join(dir, 'secret.key'))).toBe(true);
    const stored = cipher.encrypt('pass1234');
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('pass1234');
    expect(cipher.encrypt('pass1234')).not.toBe(stored); // IV สุ่มทุกครั้ง
    expect(cipher.decrypt(stored)).toBe('pass1234');
    expect(cipher.decrypt('legacy-plain')).toBe('legacy-plain');
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => cipher.decrypt(tampered)).toThrow();
  } finally {
    if (env !== undefined) process.env.SECRET_KEY = env;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session แบบ cookie ที่เซ็นไว้: ใช้ข้าม instance ได้ ปลอมไม่ได้ และหมดผลเมื่อเปลี่ยนรหัสผ่าน', () => {
  const env = { APP_PASSWORD: 'pw', SECRET_KEY: 'k', PUBLIC_HOSTS: '*.vercel.app' };
  const login = (ac) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, redirect() {} };
    ac.login({ body: { password: 'pw' }, socket: {}, secure: true }, res);
    return res.headers['Set-Cookie'];
  };
  const upgrade = (ac, host, cookie) => ac.checkUpgrade({ headers: { host, origin: `https://${host}`, cookie } });

  const setCookie = login(createAccessControl({ port: 3000, env }));
  expect(setCookie).toMatch(/^ts_session=\d+\.[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
  const cookie = setCookie.split(';')[0];

  // instance อื่นที่ตั้งค่าเหมือนกันยอมรับ cookie เดียวกัน
  const other = createAccessControl({ port: 3000, env });
  expect(upgrade(other, 'test-studio.vercel.app', cookie)).toBeNull();
  expect(upgrade(other, 'test-studio.vercel.app', cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBe('Unauthorized');
  expect(upgrade(other, 'evil.example', cookie)).toBe('Invalid Host header');
  const changed = createAccessControl({ port: 3000, env: { ...env, APP_PASSWORD: 'new' } });
  expect(upgrade(changed, 'test-studio.vercel.app', cookie)).toBe('Unauthorized');
});
