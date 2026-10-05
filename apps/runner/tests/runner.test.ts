// runner ทั้งระบบ: WebSocket จริง + Chromium จริง + Postgres จริง
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipher, signRunnerToken, type ServerMessage } from '@test-studio/core';
import { openStore, type Store } from '@test-studio/db';
import WebSocket from 'ws';
import { chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RunnerConfig } from '../src/config.js';
import { createRunner, type Runner } from '../src/server.js';

const PORT = 4851;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SECRET = 'runner-test-token-secret';
const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = fs.readFileSync(path.resolve(here, '../../../poc-screencast/public/demo-login.html'), 'utf8');

let store: Store;
let runner: Runner;
let server: Server;
let projectId: number;
let demo: Record<'email' | 'password', { x: number; y: number }>;
const opened = new Set<Client>();
const config: RunnerConfig = { port: PORT, appPort: PORT, host: '127.0.0.1', databaseUrl: '', secretKey: 'k', tokenSecret: SECRET, allowedOrigins: [ORIGIN], maxSessions: 2, runMigrations: false };

beforeAll(async () => {
  store = openStore({ url: process.env.TEST_DATABASE_URL, cipher: createCipher(null, { SECRET_KEY: 'runner-test-key' }), max: 3 });
  projectId = await store.repos.projects.create('runner-test');
  runner = await createRunner({ store, config });
  server = createServer((req, res) => {
    if (req.url === '/demo-login.html') return void res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DEMO);
    res.writeHead(404).end();
  });
  server.on('upgrade', runner.handleUpgrade);
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

  // ตำแหน่งช่องในหน้า demo ที่ viewport 1280x720 (ขนาดเดียวกับเบราว์เซอร์ของ runner) อ่านจากหน้าจริงแทนการเดาพิกัด
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${ORIGIN}/demo-login.html`);
  const center = async (selector: string) => {
    const b = (await page.locator(selector).boundingBox())!;
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  };
  demo = { email: await center('#email'), password: await center('#password') };
  await browser.close();
}, 60_000);

// ปิดการเชื่อมต่อทุกตัวหลังแต่ละเทส (แม้เทสพัง) ไม่งั้น session ที่ค้างจะกินโควตา MAX_SESSIONS ของเทสถัดไป
afterEach(async () => {
  await Promise.all([...opened].map((c) => c.close().catch(() => {})));
  opened.clear();
  for (let i = 0; i < 100 && runner.sessionCount > 0; i++) await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  await runner.close();
  server.close();
  await store.close();
});

const wsUrl = (token = signRunnerToken(SECRET, 'tester@example.com')) => `ws://127.0.0.1:${PORT}/ws?token=${token}`;

/** ไคลเอนต์ทดสอบ: เก็บทุกข้อความที่ runner ส่งมา และรอเงื่อนไขได้ */
class Client {
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      const m = JSON.parse(text) as ServerMessage;
      if (m.type !== 'frame') this.messages.push(m);
    });
  }
  static async open(url = wsUrl(), headers: Record<string, string> = { Origin: ORIGIN }): Promise<Client> {
    const ws = new WebSocket(url, { headers });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
      ws.once('error', reject);
    });
    const client = new Client(ws);
    opened.add(client);
    return client;
  }
  send(message: unknown) {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }
  async waitFor<T extends ServerMessage['type']>(type: T, predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, ms = 15_000): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.messages.find((m) => m.type === type && predicate(m as never));
      if (found) return found as never;
      if (Date.now() > deadline) throw new Error(`รอข้อความ ${type} ไม่ได้ (ได้รับ: ${[...new Set(this.messages.map((m) => m.type))].join(', ')})`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  lastState() {
    return [...this.messages].reverse().find((m): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state')!;
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((r) => this.ws.once('close', () => r()));
    this.ws.close();
    await closed;
  }
}

async function newTest(name = 't') {
  return store.repos.tests.create(projectId, name);
}

/** รอจน session ทั้งหมดปิด (หลังไคลเอนต์ตัดการเชื่อมต่อ) */
async function sessionsDrained() {
  for (let i = 0; i < 100 && runner.sessionCount > 0; i++) await new Promise((r) => setTimeout(r, 50));
}

describe('การเชื่อมต่อ', () => {
  it('ต้องมี token ที่ถูกต้อง และ Origin ที่อนุญาต', async () => {
    await expect(Client.open(`ws://127.0.0.1:${PORT}/ws`)).rejects.toMatchObject({ status: 401 });
    await expect(Client.open(wsUrl('junk'))).rejects.toMatchObject({ status: 401 });
    await expect(Client.open(wsUrl(signRunnerToken('wrong-secret', 'x')))).rejects.toMatchObject({ status: 401 });
    await expect(Client.open(wsUrl(), { Origin: 'https://evil.example' })).rejects.toMatchObject({ status: 403 });
    await expect(Client.open(wsUrl(), {})).rejects.toMatchObject({ status: 403 });
    const ok = await Client.open();
    await ok.waitFor('ready');
    expect((await ok.waitFor('ready')).viewport).toEqual({ width: 1280, height: 720 });
    await ok.close();
  });

  it('จำกัดจำนวน session พร้อมกัน และเปิดที่นั่งคืนเมื่อปิดการเชื่อมต่อ', async () => {
    const a = await Client.open();
    const b = await Client.open();
    await Promise.all([a.waitFor('ready'), b.waitFor('ready')]);
    await expect(Client.open()).rejects.toMatchObject({ status: 503 });
    await a.close();
    await sessionsDrained();
    const c = await Client.open();
    await c.waitFor('ready');
    await Promise.all([b.close(), c.close()]);
  });

  it('ข้อความที่ไม่ใช่ JSON หรือรูปแบบผิดถูกทิ้ง ไม่ทำให้ session พัง', async () => {
    const id = await newTest();
    const c = await Client.open();
    await c.waitFor('ready');
    for (const junk of ['not json', '[]', 'null', '{"type":"hack"}', '{"type":"mousemove","x":"a","y":1}', '{"type":"openTest","id":-1}', 'x'.repeat(20_000)]) c.send(junk);
    c.send({ type: 'openTest', id });
    expect((await c.waitFor('state', (m) => m.testId === id)).steps).toEqual([]);
    expect(c.messages.filter((m) => m.type === 'error')).toEqual([]);
    await c.close();
  });
});

describe('บันทึกและรัน', () => {
  async function recordLogin(c: Client, id: number) {
    c.send({ type: 'openTest', id });
    c.send({ type: 'navigate', url: `${ORIGIN}/demo-login.html` });
    await c.waitFor('state', (m) => m.testId === id && m.steps.length === 0);
    c.send({ type: 'record', on: true });
    await c.waitFor('state', (m) => m.recording);
    c.send({ type: 'mousedown', ...demo.email, button: 'left' });
    c.send({ type: 'mouseup', ...demo.email, button: 'left' });
    c.send({ type: 'text', text: 'สมชาย@test.com' });
    await c.waitFor('state', (m) => m.steps.some((s) => s.action === 'fill' && s.value === 'สมชาย@test.com'));
    c.send({ type: 'mousedown', ...demo.password, button: 'left' });
    c.send({ type: 'mouseup', ...demo.password, button: 'left' });
    c.send({ type: 'text', text: 'SuperSecret-รหัส-99' });
    await c.waitFor('state', (m) => m.steps.some((s) => s.action === 'fill' && !!s.secret));
  }

  it('step ที่บันทึกถูกเก็บใน Postgres และ session ใหม่เปิดมาเห็นครบ', async () => {
    const id = await newTest('persist');
    const c = await Client.open();
    await c.waitFor('ready');
    await recordLogin(c, id);
    await c.close();
    await sessionsDrained();

    const stored = await store.repos.tests.get(id);
    expect(stored!.steps.map((s) => s.action)).toEqual(['goto', 'fill', 'fill']);
    const c2 = await Client.open();
    c2.send({ type: 'openTest', id });
    const state = await c2.waitFor('state', (m) => m.testId === id);
    expect(state.steps.map((s) => s.label)).toEqual([`เปิด ${ORIGIN}/demo-login.html`, 'พิมพ์ ช่อง "อีเมล" "สมชาย@test.com"', expect.stringMatching(/^พิมพ์ ช่อง "รหัสผ่าน" •+ \(TEST_PASSWORD\)$/)]);
    await c2.close();
  });

  it('รหัสผ่านที่พิมพ์ไม่หลุดออกมาในข้อความใดๆ ของ runner และถูกเก็บแบบเข้ารหัส', async () => {
    const id = await newTest('no-leak');
    const c = await Client.open();
    await c.waitFor('ready');
    await recordLogin(c, id);
    c.send({ type: 'record', on: false });
    c.send({ type: 'run' });
    await c.waitFor('runDone');
    c.send({ type: 'export' });
    const exported = await c.waitFor('export');
    c.send({ type: 'updateStep', id: (await c.lastState()).steps[2]!.id!, step: { action: 'fill', locator: { type: 'label', value: 'รหัสผ่าน' }, secret: 'TEST_PASSWORD' } });
    await c.waitFor('state', (m) => m.steps.length === 3);

    const everything = c.raw.join('\n');
    expect(everything).not.toContain('SuperSecret');
    expect(exported.code).toContain("process.env.TEST_PASSWORD ?? ''");
    expect(exported.json).not.toContain('SuperSecret');
    // ในฐานข้อมูล: เข้ารหัส และถอดกลับเป็นค่าที่พิมพ์
    const names = await store.repos.secrets.names(projectId);
    expect(names).toContain('TEST_PASSWORD');
    expect((await store.repos.secrets.values(projectId)).TEST_PASSWORD).toBe('SuperSecret-รหัส-99');
    await c.close();
  });

  it('รันเทสแล้วบันทึกผลและประวัติใน Postgres พร้อมแจ้งความคืบหน้าทีละ step', async () => {
    const id = await newTest('run');
    await store.repos.tests.saveSteps(id, [
      { id: 1, action: 'goto', value: `${ORIGIN}/demo-login.html` },
      { id: 2, action: 'assertText', locator: { type: 'css', value: 'h2' }, expected: 'เข้าสู่ระบบ' },
      { id: 3, action: 'click', locator: { type: 'css', value: '#nope' } },
      { id: 4, action: 'assertURL', expected: 'http://never/' },
    ]);
    const c = await Client.open();
    c.send({ type: 'openTest', id });
    await c.waitFor('state', (m) => m.testId === id && m.steps.length === 4);
    c.send({ type: 'run' });
    const done = await c.waitFor('runDone', () => true, 30_000);
    expect(done.passed).toBe(false);
    expect(done.hasScreenshot).toBe(true);
    const progress = c.messages.filter((m) => m.type === 'runStep').map((m) => `${m.id}:${(m as { status: string }).status}`);
    expect(progress).toEqual(['1:running', '1:passed', '2:running', '2:passed', '3:running', '3:failed', '4:skipped']);

    const run = await store.repos.runs.get(done.runId);
    expect(run!.results.map((r) => r.status)).toEqual(['passed', 'passed', 'failed', 'skipped']);
    expect(run!.results[2]!.error).toContain('5 วินาที');
    const shot = await store.repos.runs.screenshot(done.runId);
    expect(shot!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
    expect((await store.repos.tests.list(projectId)).find((t) => t.id === id)!.lastPassed).toBe(false);
    // กลับมาเปิดเทสนี้ใหม่ จะเห็น health ของ step ที่พัง
    expect(c.lastState().health[3]).toEqual({ runs: 1, healed: 0, failed: 1 });
    await c.close();
  }, 60_000);

  it('step โค้ด: ลองรันกับหน้าเว็บสดผ่าน testScript และรันในเทสจริง', async () => {
    const id = await newTest('script');
    await store.repos.tests.saveSteps(id, [
      { id: 1, action: 'goto', value: `${ORIGIN}/demo-login.html` },
      { id: 2, action: 'script', script: "// ต้องมีช่องอีเมล\nreturn !!document.querySelector('#email');" },
      { id: 3, action: 'script', script: 'return false;' },
    ]);
    const c = await Client.open();
    c.send({ type: 'openTest', id });
    c.send({ type: 'navigate', url: `${ORIGIN}/demo-login.html` });
    const state = await c.waitFor('state', (m) => m.testId === id && m.steps.length === 3);
    expect(state.steps[1]!.label).toBe('รันโค้ด ต้องมีช่องอีเมล');
    await c.waitFor('url', (m) => m.url.endsWith('/demo-login.html'));

    c.send({ type: 'testScript', script: 'return document.title;' });
    const ok = await c.waitFor('scriptResult');
    expect(ok).toMatchObject({ ok: true, value: expect.any(String) });
    c.messages.length = 0;
    c.send({ type: 'testScript', script: "throw new Error('ไม่เจอ');" });
    expect(await c.waitFor('scriptResult')).toMatchObject({ ok: false, error: 'โค้ดผิดพลาด: ไม่เจอ' });

    c.send({ type: 'run' });
    const done = await c.waitFor('runDone', () => true, 30_000);
    expect(done.passed).toBe(false);
    const run = await store.repos.runs.get(done.runId);
    expect(run!.results.map((r) => r.status)).toEqual(['passed', 'passed', 'failed']);
    expect(run!.results[2]!.error).toBe('โค้ดคืนค่า false (ไม่ผ่าน)');
    await c.close();
  }, 60_000);
});

describe('SSRF', () => {
  it('เปิด URL ภายใน/metadata/ไฟล์ในเครื่อง ผ่านแถบ URL หรือ step ไม่ได้ และแจ้งเหตุผล', async () => {
    const id = await newTest('ssrf');
    await store.repos.tests.saveSteps(id, [{ id: 1, action: 'goto', value: 'http://169.254.169.254/latest/meta-data/' }]);
    const c = await Client.open();
    c.send({ type: 'openTest', id });
    c.send({ type: 'navigate', url: 'http://169.254.169.254/' });
    c.send({ type: 'navigate', url: 'file:///etc/passwd' });
    c.send({ type: 'navigate', url: `${ORIGIN}/api/secrets` }); // API ของระบบเองต้องเปิดไม่ได้ มีแค่หน้า demo
    await c.waitFor('error', (m) => m.message.includes('เครือข่าย'));
    await c.waitFor('error', (m) => m.message.includes('http หรือ https'));
    await c.waitFor('error', (m) => m.message.includes('หน้า demo'));
    c.send({ type: 'run' });
    await c.waitFor('runDone');
    expect((await c.waitFor('runStep', (m) => m.status === 'failed')).error).toContain('ไม่อนุญาต');
    await c.close();
  }, 60_000);

  it('step โค้ดเข้าถึงเครือข่ายภายในไม่ได้: fetch, เปลี่ยนหน้า, API ของระบบ และ WebRTC', async () => {
    // บริการภายในจำลอง: ถ้ามี request หลุดมาถึง hits จะไม่เป็น 0
    let hits = 0;
    const internal = createServer((_req, res) => { hits++; res.end('internal'); });
    await new Promise<void>((r) => internal.listen(0, '127.0.0.1', r));
    const internalUrl = `http://127.0.0.1:${(internal.address() as { port: number }).port}/`;
    const c = await Client.open();
    c.send({ type: 'navigate', url: `${ORIGIN}/demo-login.html` });
    await c.waitFor('url', (m) => m.url.endsWith('/demo-login.html'));
    const run = async (script: string) => {
      c.messages.length = 0;
      c.send({ type: 'testScript', script });
      return c.waitFor('scriptResult', () => true, 20_000);
    };

    expect(await run(`await fetch('${internalUrl}', { mode: 'no-cors' }).catch(() => {}); return 1;`)).toMatchObject({ ok: true });
    expect(await run(`const img = new Image(); img.src = '${internalUrl}img'; await new Promise((r) => { img.onload = img.onerror = r; }); return 1;`)).toMatchObject({ ok: true });
    expect(hits).toBe(0);
    expect(await run(`return (await fetch('${ORIGIN}/api/secrets')).status;`)).toMatchObject({ ok: true, value: '403' });
    const candidates = await run(`const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:10.0.0.1:3478' }] });
pc.createDataChannel('x');
const found = [];
pc.onicecandidate = (e) => { if (e.candidate) found.push(e.candidate.type); };
await pc.setLocalDescription(await pc.createOffer());
await new Promise((r) => { const t = setTimeout(r, 3000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }; });
pc.close();
return found;`);
    expect(candidates).toMatchObject({ ok: true, value: '[]' });

    await run(`location.href = '${internalUrl}';`);
    await c.waitFor('url', (m) => m.url === internalUrl, 10_000);
    expect(await run('return document.title;')).toMatchObject({ ok: true, value: 'ถูกบล็อก' });
    expect(hits).toBe(0);
    await c.close();
    internal.close();
  }, 60_000);
});

describe('ไม่รบกวนกัน', () => {
  it('สองผู้ใช้แก้คนละเทสพร้อมกัน เบราว์เซอร์และข้อมูลแยกกัน', async () => {
    const [idA, idB] = [await newTest('A'), await newTest('B')];
    const [a, b] = await Promise.all([Client.open(), Client.open()]);
    await Promise.all([a.waitFor('ready'), b.waitFor('ready')]);
    a.send({ type: 'openTest', id: idA });
    b.send({ type: 'openTest', id: idB });
    a.send({ type: 'navigate', url: `${ORIGIN}/demo-login.html` });
    await a.waitFor('url', (m) => m.url.endsWith('/demo-login.html'));
    expect(b.messages.some((m) => m.type === 'url' && m.url.includes('demo-login'))).toBe(false);
    a.send({ type: 'record', on: true });
    a.send({ type: 'press', key: 'Enter' });
    await a.waitFor('state', (m) => m.steps.length > 0);
    expect((await store.repos.tests.get(idB))!.steps).toEqual([]);
    await Promise.all([a.close(), b.close()]);
  }, 60_000);
});
