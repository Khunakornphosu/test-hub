// ความปลอดภัย: SSRF, Host/Origin, รหัสผ่านเข้าใช้งาน, การเปิดให้เครื่องอื่นเข้า
import { test as base, expect } from '@playwright/test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { test } from './helpers.js';
import { APP, AUTH_APP } from '../playwright.config.js';
import { createUrlGuard, startGuardProxy } from '../security.js';

// ฟีเจอร์เฉพาะของ PoC เดิม (รหัสผ่านเดียว, ตรวจ Host ของ express) ระบบใหม่ใช้ token/Google login แทน
const RUNNER = process.env.POC_BACKEND === 'runner';

const port = (url) => new URL(url).port;

// request ด้วย Host header ที่กำหนดเอง (fetch ของ Node ไม่ให้แก้ Host)
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http
      .get({ host: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
}

function wsConnect(url, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
}

base.describe('Host และ Origin', () => {
  base('Host header แปลกปลอมถูกปฏิเสธ (กัน DNS rebinding)', async () => {
    base.skip(RUNNER, 'ตรวจ Host ของ HTTP เป็นของ PoC เดิม (runner ตรวจ Host ตอนเปิด WebSocket)');
    expect(await rawGet(`${APP}/api/projects`, { Host: 'evil.example' })).toBe(421);
    expect(await rawGet(`${APP}/api/projects`, { Host: `localhost:${port(APP)}` })).toBe(200);
  });

  base('WebSocket จากเว็บอื่นถูกปฏิเสธ (กัน Cross-Site WebSocket Hijacking)', async () => {
    const ws = APP.replace('http', 'ws') + '/ws';
    expect(await wsConnect(ws, { Origin: 'https://evil.example' })).toBe(403);
    expect(await wsConnect(ws, {})).toBe(403);
    expect(await wsConnect(ws, { Origin: APP })).toBe('open');
  });
});

test.describe('SSRF', () => {
  test('เปิด URL ภายในหรือ API ของระบบเองจากแถบ URL ไม่ได้', async ({ studio, page }) => {
    await studio.navigate('http://169.254.169.254/latest/meta-data/');
    await expect(page.locator('.Toast--error')).toContainText('ไม่อนุญาตให้เปิดที่อยู่ภายในเครือข่าย');
    await studio.navigate(`${APP}/api/projects`);
    await expect(page.locator('.Toast--error').last()).toContainText('เปิดได้เฉพาะหน้า demo ของระบบนี้');
    await studio.navigate('file:///etc/passwd');
    await expect(page.locator('.Toast--error').last()).toContainText('เปิดได้เฉพาะ URL แบบ http หรือ https');
  });

  test('step "เปิด URL" ที่ชี้ไปเครือข่ายภายในทำให้เทสพังพร้อมเหตุผล', async ({ studio, page }) => {
    const editor = await studio.addStep('goto');
    await editor.getByLabel('URL').fill('http://127.0.0.1:22/');
    await studio.saveEditor();
    expect(await studio.run()).toContain('ไม่ผ่านที่ step 1');
    await expect(page.locator('#steps .step-error')).toContainText('ไม่อนุญาตให้เปิดที่อยู่ภายในเครือข่าย');
  });

  base('proxy กัน redirect ทุก hop, รูป/fetch และ IPv6 ไปเครือข่ายภายใน', async () => {
    const hits = [];
    const internal = http.createServer((q, r) => (hits.push(q.url), r.end('INTERNAL SECRET'))).listen(4402);
    const outer = http
      .createServer((q, r) => {
        if (q.url === '/hop1') return r.writeHead(302, { Location: '/hop2' }).end();
        if (q.url === '/hop2') return r.writeHead(302, { Location: 'http://127.0.0.1:4402/secret' }).end();
        if (q.url === '/sub') {
          r.setHeader('Content-Type', 'text/html');
          return r.end('<img src="http://127.0.0.1:4402/x.png"><script>fetch("http://[::1]:4402/api").finally(() => (document.title = "done"))</script>');
        }
        r.end('PUBLIC OK');
      })
      .listen(4401);
    // ในเทสทุกอย่างอยู่ในเครื่อง จึงให้ localhost:4401 เป็นตัวแทนเว็บภายนอกผ่าน allowlist
    const proxy = await startGuardProxy(createUrlGuard({ appPort: 4400, env: { ALLOWED_HOSTS: 'localhost' } }));
    const browser = await chromium.launch(proxy.launchOptions);
    try {
      const page = await browser.newPage();
      await page.goto('http://localhost:4401/');
      await expect(page.locator('body')).toHaveText('PUBLIC OK');
      const res = await page.goto('http://localhost:4401/hop1');
      expect(res.status()).toBe(403);
      await expect(page.locator('body')).toContainText('Test Studio บล็อกการเข้าถึงนี้');
      await page.goto('http://localhost:4401/sub');
      await expect(page).toHaveTitle('done');
      expect(hits).toEqual([]);
    } finally {
      await browser.close();
      proxy.close();
      internal.close();
      outer.close();
    }
  });
});

base.describe('APP_PASSWORD', () => {
  base.skip(RUNNER, 'รหัสผ่านเดียวเป็นของ PoC เดิม');
  base.use({ baseURL: AUTH_APP });

  base('ต้องล็อกอินก่อนใช้งาน และหน้า demo ยังเปิดได้', async ({ page, request }) => {
    expect((await request.get('/api/projects', { maxRedirects: 0 })).status()).toBe(401);
    expect((await request.get('/demo-login.html')).status()).toBe(200);
    expect(await wsConnect(AUTH_APP.replace('http', 'ws') + '/ws', { Origin: AUTH_APP })).toBe(403);

    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('รหัสผ่านเข้าใช้งาน').fill('wrong');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page.locator('#error')).toHaveText('รหัสผ่านไม่ถูกต้อง');

    await page.getByLabel('รหัสผ่านเข้าใช้งาน').fill('letmein');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
    await expect(page.locator('#url')).toHaveValue(`${AUTH_APP}/demo-login.html`);

    // cookie ตั้งค่าอย่างปลอดภัย
    const cookie = (await page.context().cookies()).find((c) => c.name === 'ts_session');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');

    await page.click('#moreMenu summary');
    await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});

base('เปิดให้เครื่องอื่นเข้าถึง (HOST=0.0.0.0) โดยไม่ตั้ง APP_PASSWORD ต้องไม่ยอมเริ่มทำงาน', async () => {
  base.skip(RUNNER, 'ทดสอบ server.js ของ PoC เดิม (ของ runner ดู apps/runner/tests/config.test.ts)');
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, ENV_FILE: 'none', HOST: '0.0.0.0', PORT: '4450', DB_PATH: ':memory:', APP_PASSWORD: '' },
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((resolve) => child.on('exit', resolve));
  expect(code).toBe(1);
  expect(stderr).toContain('กรุณาตั้ง APP_PASSWORD');
});
