// รัน step กับเบราว์เซอร์จริง: ทดสอบ self-healing และข้อความ error ของแต่ละ action
import http from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blankStep, runScript, runStep, sanitizeStep, type Step } from '../src/index.js';

const PAGES: Record<string, string> = {
  '/v1': `<h1>เข้าสู่ระบบ</h1>
    <label>อีเมล <input id="email" placeholder="you@example.com"></label>
    <select aria-label="บทบาท"><option value="tester">Tester</option><option value="dev">Developer</option></select>
    <label><input id="remember" type="checkbox"> จดจำฉัน</label>
    <button id="go" type="submit" onclick="document.title='clicked'">เข้าสู่ระบบ</button><ul><li>a</li><li>b</li></ul>`,
  // เว็บถูกแก้: ชื่อช่องและข้อความปุ่มเปลี่ยน (id/placeholder เดิมยังอยู่)
  '/v2': `<h1>เข้าสู่ระบบ</h1>
    <label>อีเมลผู้ใช้ <input id="email" placeholder="you@example.com"></label>
    <button id="go" type="submit" onclick="document.title='clicked'">ลงชื่อเข้าใช้</button>`,
  // เว็บถูกแก้จนเป็นคนละปุ่ม: ไม่ใช่ element เดิมแล้ว
  '/v3': `<h1>เข้าสู่ระบบ</h1><a id="go" href="#">ไปหน้าสมัครสมาชิก</a>`,
  '/form': `<label>ชื่อ <input id="name"></label><input id="phone" aria-label="เบอร์โทร">`,
};

let server: http.Server;
let browser: Browser;
let page: Page;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><title>t</title>${PAGES[req.url ?? ''] ?? ''}`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  server.close();
});
beforeEach(async () => {
  page = await (await browser.newContext()).newPage();
});

const button = (extra: Record<string, unknown> = {}): Step =>
  sanitizeStep({
    action: 'click',
    locator: { type: 'role', role: 'button', name: 'เข้าสู่ระบบ' },
    fallbacks: [{ type: 'css', value: '#go' }],
    fingerprint: { tag: 'button', type: 'submit', id: 'go', text: 'เข้าสู่ระบบ' },
    ...extra,
  });

describe('runStep', () => {
  it('ทำงานตามปกติเมื่อ locator หลักเจอ ไม่ต้องซ่อม', async () => {
    await page.goto(`${base}/v1`);
    const result = await runStep(page, button());
    expect(result).toEqual({});
    expect(await page.title()).toBe('clicked');
  });

  it('locator หลักหาไม่เจอ: ใช้ตัวสำรองที่ลายนิ้วมือตรง และรายงานว่าซ่อม', async () => {
    await page.goto(`${base}/v2`);
    const result = await runStep(page, button());
    expect(result.healed).toEqual({ type: 'css', value: '#go' });
    expect(await page.title()).toBe('clicked');
  }, 15_000);

  it('ตัวสำรองไปชี้คนละ element: ไม่ซ่อม แต่ให้พังตามปกติ', async () => {
    await page.goto(`${base}/v3`);
    await expect(runStep(page, button())).rejects.toThrow();
    expect(await page.title()).toBe('t');
  }, 20_000);

  it('step ที่ไม่มี fallbacks ไม่ซ่อม และ assertCount ไม่ซ่อมเสมอ', async () => {
    await page.goto(`${base}/v2`);
    await expect(runStep(page, sanitizeStep({ action: 'click', locator: { type: 'role', role: 'button', name: 'เข้าสู่ระบบ' } }))).rejects.toThrow();
  }, 15_000);

  it('fill / select / check / assert ทำงานและแจ้ง error ภาษาไทยเมื่อไม่ตรง', async () => {
    await page.goto(`${base}/v1`);
    await runStep(page, sanitizeStep({ action: 'fill', locator: { type: 'label', value: 'อีเมล' }, value: 'a@b.com' }));
    expect(await page.inputValue('#email')).toBe('a@b.com');
    await runStep(page, sanitizeStep({ action: 'selectOption', locator: { type: 'role', role: 'combobox', name: 'บทบาท' }, value: 'Developer' }));
    expect(await page.locator('select').inputValue()).toBe('dev');
    await runStep(page, sanitizeStep({ action: 'check', locator: { type: 'css', value: '#remember' } }));
    expect(await page.isChecked('#remember')).toBe(true);
    await runStep(page, sanitizeStep({ action: 'assertCount', locator: { type: 'css', value: 'li' }, expected: '2' }));
    await runStep(page, sanitizeStep({ action: 'assertText', locator: { type: 'css', value: 'h1' }, expected: 'เข้าสู่' }));

    await expect(runStep(page, sanitizeStep({ action: 'assertCount', locator: { type: 'css', value: 'li' }, expected: '5' }))).rejects.toThrow('จำนวนไม่ตรง: คาดว่า 5 แต่เจอ 2');
    await expect(runStep(page, sanitizeStep({ action: 'assertText', locator: { type: 'css', value: 'h1' }, expected: 'สมัคร' }))).rejects.toThrow('ข้อความไม่ตรง: คาดว่ามี "สมัคร" แต่เจอ "เข้าสู่ระบบ"');
    await expect(runStep(page, sanitizeStep({ action: 'assertURL', expected: 'http://x/' }))).rejects.toThrow('URL ไม่ตรง');
  }, 60_000);

  it('ตัวแปรลับ: ใช้ค่าจาก secrets และแจ้งเมื่อยังไม่ได้ตั้ง', async () => {
    await page.goto(`${base}/v1`);
    const step = sanitizeStep({ action: 'fill', locator: { type: 'css', value: '#email' }, secret: 'PW' });
    await expect(runStep(page, step)).rejects.toThrow('ยังไม่ได้ตั้งค่าตัวแปรลับ PW');
    await runStep(page, step, { secrets: { PW: 'hunter2' } });
    expect(await page.inputValue('#email')).toBe('hunter2');
  });

  it('script รันในหน้าเว็บ: ผ่าน/คืนค่า, return false, throw, syntax error และหมดเวลา', async () => {
    await page.goto(`${base}/v1`);
    await runStep(page, sanitizeStep({ action: 'script', script: "document.querySelector('#email').value = 'js@test';" }));
    expect(await page.inputValue('#email')).toBe('js@test');
    expect(await runScript(page, "return document.querySelector('h1').textContent;")).toEqual({ value: 'เข้าสู่ระบบ' });
    expect(await runScript(page, 'return { n: document.querySelectorAll("li").length };')).toEqual({ value: '{"n":2}' });
    expect(await runScript(page, 'await new Promise((r) => setTimeout(r, 50)); return true;')).toEqual({ value: 'true' });
    expect(await runScript(page, 'return document.body;')).toEqual({ value: '{}' });
    expect(await runScript(page, '// แค่คอมเมนต์')).toEqual({});

    await expect(runStep(page, sanitizeStep({ action: 'script', script: 'return false;' }))).rejects.toThrow('โค้ดคืนค่า false (ไม่ผ่าน)');
    await expect(runScript(page, "throw new Error('ไม่เจอปุ่ม');")).rejects.toThrow('โค้ดผิดพลาด: ไม่เจอปุ่ม');
    await expect(runScript(page, 'return (;')).rejects.toThrow(/^โค้ดผิดพลาด: SyntaxError/);
    await expect(runScript(page, 'await new Promise(() => {});', 300)).rejects.toThrow('โค้ดทำงานนานเกิน 0.3 วินาที');
    await expect(runStep(page, blankStep('script'))).rejects.toThrow('step นี้ยังไม่ได้เขียนโค้ด');
  });

  it('fillForm กรอกทุกช่องใน step เดียว ทั้งจาก locator และ label', async () => {
    await page.goto(`${base}/form`);
    await runStep(page, sanitizeStep({
      action: 'fillForm',
      fields: [
        { label: 'ชื่อ', value: 'สมชาย' },
        { locator: { type: 'css', value: '#phone' }, value: '0812345678' },
      ],
    }));
    expect(await page.inputValue('#name')).toBe('สมชาย');
    expect(await page.inputValue('#phone')).toBe('0812345678');

    await expect(runStep(page, blankStep('fillForm'))).rejects.toThrow('กรุณาระบุ label ของทุกช่องในฟอร์ม');
    await expect(runStep(page, sanitizeStep({ action: 'fillForm', fields: [] }))).rejects.toThrow('กรุณาระบุ label ของทุกช่องในฟอร์ม');
  });

  it('goto ผ่าน checkUrl ก่อนเสมอ และ step ที่ไม่สมบูรณ์/useTest ไม่รัน', async () => {
    const blocked = sanitizeStep({ action: 'goto', value: 'http://169.254.169.254/' });
    await expect(runStep(page, blocked, { checkUrl: () => { throw new Error('ถูกบล็อก'); } })).rejects.toThrow('ถูกบล็อก');
    await expect(runStep(page, sanitizeStep({ action: 'click' }))).rejects.toThrow('ยังไม่ได้เลือก element');
    await expect(runStep(page, sanitizeStep({ action: 'useTest', testId: 3 }))).rejects.toThrow('ต้องถูกขยายก่อนรัน');
    await expect(runStep(page, sanitizeStep({ action: 'useTest' }))).rejects.toThrow('ยังไม่ได้เลือกเทส');
  });
});
