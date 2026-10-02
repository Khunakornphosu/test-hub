// รัน step กับเบราว์เซอร์จริง: ทดสอบ self-healing และข้อความ error ของแต่ละ action
import http from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runStep, sanitizeStep, type Step } from '../src/index.js';

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

  it('goto ผ่าน checkUrl ก่อนเสมอ และ step ที่ไม่สมบูรณ์/useTest ไม่รัน', async () => {
    const blocked = sanitizeStep({ action: 'goto', value: 'http://169.254.169.254/' });
    await expect(runStep(page, blocked, { checkUrl: () => { throw new Error('ถูกบล็อก'); } })).rejects.toThrow('ถูกบล็อก');
    await expect(runStep(page, sanitizeStep({ action: 'click' }))).rejects.toThrow('ยังไม่ได้เลือก element');
    await expect(runStep(page, sanitizeStep({ action: 'useTest', testId: 3 }))).rejects.toThrow('ต้องถูกขยายก่อนรัน');
    await expect(runStep(page, sanitizeStep({ action: 'useTest' }))).rejects.toThrow('ยังไม่ได้เลือกเทส');
  });
});
