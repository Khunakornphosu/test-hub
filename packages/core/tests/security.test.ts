import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { createCipher, createUrlGuard, startGuardProxy } from '../src/index.js';

describe('createUrlGuard', () => {
  const guard = (env: Record<string, string> = {}) => createUrlGuard({ appPort: 3000, env });

  it('ค่าเริ่มต้น: กัน scheme อื่น, เครือข่ายภายใน, cloud metadata และ API ของระบบเอง', async () => {
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
      'not a url',
    ]) {
      expect((await g.check(url)).ok, url).toBe(false);
    }
    expect((await g.check('http://localhost:3000/demo-login.html')).ok).toBe(true);
    expect((await g.check('http://93.184.215.14/')).ok).toBe(true);
  });

  it('ALLOWED_HOSTS อนุญาตเฉพาะโดเมนที่ระบุ (รองรับ *.)', async () => {
    const g = guard({ ALLOWED_HOSTS: 'staging.internal, *.example.com' });
    expect((await g.check('http://staging.internal/')).ok).toBe(true);
    expect((await g.check('https://a.example.com/')).ok).toBe(true);
    expect((await g.check('https://example.com/')).ok).toBe(true);
    expect((await g.check('https://evil.com/')).ok).toBe(false);
    expect((await g.check('https://notexample.com/')).ok).toBe(false);
  });

  it('ALLOW_PRIVATE_NETWORK=true เปิดเครือข่ายภายในได้', async () => {
    expect((await guard({ ALLOW_PRIVATE_NETWORK: 'true' }).check('http://127.0.0.1:8080/')).ok).toBe(true);
  });
});

describe('createCipher', () => {
  it('เข้ารหัสแล้วถอดกลับได้ และจับได้ถ้าข้อมูลถูกแก้', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cipher-'));
    try {
      const cipher = createCipher(dir, {});
      expect(fs.existsSync(path.join(dir, 'secret.key'))).toBe(true);
      const stored = cipher.encrypt('pass1234');
      expect(stored).toMatch(/^enc:v1:/);
      expect(stored).not.toContain('pass1234');
      expect(cipher.encrypt('pass1234')).not.toBe(stored); // IV สุ่มทุกครั้ง
      expect(cipher.decrypt(stored)).toBe('pass1234');
      expect(cipher.decrypt('legacy-plain')).toBe('legacy-plain');
      expect(cipher.isEncrypted(stored)).toBe(true);
      expect(() => cipher.decrypt(stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA'))).toThrow();
      // key เดียวกันจากโฟลเดอร์เดิมถอดได้ แต่ key อื่นถอดไม่ได้
      expect(createCipher(dir, {}).decrypt(stored)).toBe('pass1234');
      expect(() => createCipher(dir, { SECRET_KEY: 'other' }).decrypt(stored)).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dataDir = null ใช้ key ชั่วคราวและไม่เขียนไฟล์', () => {
    const cipher = createCipher(null, {});
    expect(cipher.decrypt(cipher.encrypt('x'))).toBe('x');
  });
});

describe('startGuardProxy', () => {
  it('กัน redirect ทุก hop, รูป/fetch และ IPv6 ไปเครือข่ายภายใน', async () => {
    const hits: string[] = [];
    const internal = http.createServer((q, r) => (hits.push(q.url ?? ''), r.end('INTERNAL SECRET'))).listen(4452);
    const outer = http
      .createServer((q, r) => {
        if (q.url === '/hop1') return void r.writeHead(302, { Location: '/hop2' }).end();
        if (q.url === '/hop2') return void r.writeHead(302, { Location: 'http://127.0.0.1:4452/secret' }).end();
        if (q.url === '/sub') {
          r.setHeader('Content-Type', 'text/html');
          return void r.end('<img src="http://127.0.0.1:4452/x.png"><script>fetch("http://[::1]:4452/api").finally(() => (document.title = "done"))</script>');
        }
        r.end('PUBLIC OK');
      })
      .listen(4451);
    // ในเทสทุกอย่างอยู่ในเครื่อง จึงให้ localhost:4451 เป็นตัวแทนเว็บภายนอกผ่าน allowlist
    const proxy = await startGuardProxy(createUrlGuard({ appPort: 4450, env: { ALLOWED_HOSTS: 'localhost' } }));
    const browser = await chromium.launch(proxy.launchOptions);
    try {
      const page = await browser.newPage();
      await page.goto('http://localhost:4451/');
      expect(await page.textContent('body')).toBe('PUBLIC OK');
      const res = await page.goto('http://localhost:4451/hop1');
      expect(res?.status()).toBe(403);
      expect(await page.textContent('body')).toContain('Test Studio บล็อกการเข้าถึงนี้');
      await page.goto('http://localhost:4451/sub');
      await page.waitForFunction(() => document.title === 'done');
      expect(hits).toEqual([]);
    } finally {
      await browser.close();
      proxy.close();
      internal.close();
      outer.close();
    }
  }, 30_000);
});
