// PoC: แสดงหน้าเว็บที่ Playwright เปิดอยู่บน canvas ผ่าน CDP screencast
// ส่ง input (เมาส์/คีย์บอร์ด/ภาษาไทย) จาก canvas กลับไปทำบนหน้าจริง
// บันทึกการกระทำเป็น step JSON -> แก้ไข / รันซ้ำ / Export เป็นโค้ด Playwright
// โปรเจกต์ เทสเคส ตัวแปรลับ และประวัติการรันเก็บใน SQLite
import './env.js';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import {
  ACTIONS,
  LOCATOR_TYPES,
  blankStep,
  describeParts,
  describeStep,
  exportJson,
  exportTest,
  isComplete,
  locatorToCode,
  toLocator,
  runStep,
  sanitizeStep,
  stepToCode,
} from './steps.js';
import {
  clearHighlight,
  elementAt,
  focusedEditable,
  highlightAt,
  highlightLocator,
  inspect,
  targetFor,
} from './recorder.js';
import * as db from './db.js';
import { aiStatus, generateSteps, redactSnapshot } from './ai.js';
import octicons from '@primer/octicons';
import { createAccessControl, createUrlGuard, isLoopbackBind, startGuardProxy } from './security.js';

const PORT = Number(process.env.PORT) || 3000;
// ค่าเริ่มต้นเปิดให้เข้าได้เฉพาะเครื่องนี้ ถ้าจะให้เครื่องอื่นเข้า (HOST=0.0.0.0) ต้องตั้ง APP_PASSWORD
const HOST = process.env.HOST || '127.0.0.1';
const access = createAccessControl({ port: PORT });
if (!isLoopbackBind(HOST) && !access.enabled) {
  console.error(`[security] HOST=${HOST} เปิดให้เครื่องอื่นเข้าถึงได้ กรุณาตั้ง APP_PASSWORD ใน .env ก่อน`);
  process.exit(1);
}
const VIEWPORT = { width: 1280, height: 720 };
const HIGHLIGHT_COLOR = { interact: '#3b82f6', assertVisible: '#16a34a', assertText: '#16a34a', pick: '#eab308' };
// ปุ่มที่บันทึกเป็น step press (ปุ่มอื่น เช่น Tab/ลูกศร ไม่จำเป็นต่อการรันซ้ำ)
const RECORDED_KEYS = new Set(['Enter', 'Escape']);

const app = express();
app.disable('x-powered-by');
app.use(access.middleware);
app.use(express.json());
app.get('/login', (req, res) => res.sendFile('login.html', { root: 'private' }));
app.post('/login', express.urlencoded({ extended: false }), access.login);
app.post('/logout', access.logout);
app.get('/api/auth', (req, res) => res.json({ enabled: access.enabled }));
app.use(express.static('public'));

// Design system: GitHub Primer (MIT) — CSS/tokens จาก npm และไอคอน Octicons
app.use('/vendor/primer', express.static('node_modules/@primer/css/dist'));
app.use('/vendor/primitives', express.static('node_modules/@primer/primitives/dist/css'));
const ICONS = [
  'dot-fill', 'square-fill', 'play', 'eye', 'quote', 'link', 'number', 'globe', 'pencil', 'check-circle-fill',
  'x-circle-fill', 'skip', 'grabber', 'trash', 'kebab-horizontal', 'download', 'copy', 'lock', 'plus', 'x',
  'arrow-left', 'arrow-right', 'sync', 'history', 'code', 'checklist', 'crosshairs', 'beaker', 'command-palette',
  'single-select', 'checkbox', 'square', 'cursor', 'info', 'alert', 'clock', 'triangle-down', 'file', 'project',
  'check', 'stop', 'light-bulb', 'list-ordered', 'chevron-down', 'chevron-right', 'stack', 'tools', 'link-external', 'sparkle-fill', 'shield-lock', 'sign-out',
];
const iconsJs = `window.ICONS = ${JSON.stringify(Object.fromEntries(ICONS.map((n) => [n, octicons[n].toSVG()])))};`;
app.get('/icons.js', (req, res) => res.type('js').send(iconsJs));

// ---------- REST: โปรเจกต์ เทสเคส ตัวแปรลับ ประวัติการรัน ----------
const id = (req, key = 'id') => Number(req.params[key]);
const requireName = (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) res.status(400).json({ error: 'กรุณาระบุชื่อ' });
  return name;
};

app.get('/api/projects', (req, res) => res.json(db.projects.list()));
app.post('/api/projects', (req, res) => {
  const name = requireName(req, res);
  if (name) res.json({ id: db.projects.create(name) });
});
app.delete('/api/projects/:id', (req, res) => {
  db.projects.remove(id(req));
  res.json({ ok: true });
});

app.get('/api/projects/:id/tests', (req, res) => res.json(db.tests.list(id(req))));
app.get('/api/tests/:id', (req, res) => {
  const t = db.tests.get(id(req));
  t ? res.json({ id: t.id, project_id: t.project_id, name: t.name }) : res.status(404).json({ error: 'ไม่พบเทสเคสนี้' });
});
app.post('/api/projects/:id/tests', (req, res) => {
  const name = requireName(req, res);
  if (name) res.json({ id: db.tests.create(id(req), name) });
});
app.patch('/api/tests/:id', (req, res) => {
  const name = requireName(req, res);
  if (name) {
    db.tests.rename(id(req), name);
    res.json({ ok: true });
  }
});
app.delete('/api/tests/:id', (req, res) => {
  db.tests.remove(id(req));
  res.json({ ok: true });
});

// ตัวแปรลับ: ส่งกลับเฉพาะชื่อ ไม่ส่งค่าจริงออกไปหน้าเว็บ
app.get('/api/projects/:id/secrets', (req, res) => res.json(db.secrets.names(id(req))));
app.put('/api/projects/:id/secrets/:name', (req, res) => {
  const name = req.params.name.toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return res.status(400).json({ error: 'ชื่อตัวแปรไม่ถูกต้อง' });
  db.secrets.set(id(req), name, String(req.body?.value ?? ''));
  res.json({ ok: true });
});
app.delete('/api/projects/:id/secrets/:name', (req, res) => {
  db.secrets.remove(id(req), req.params.name);
  res.json({ ok: true });
});

app.get('/api/ai/status', (req, res) => res.json(aiStatus()));

app.get('/api/tests/:id/runs', (req, res) => res.json(db.runs.list(id(req))));
app.get('/api/runs/:id', (req, res) => {
  const run = db.runs.get(id(req));
  run ? res.json(run) : res.status(404).json({ error: 'ไม่พบการรันนี้' });
});
app.get('/api/runs/:id/screenshot', (req, res) => {
  const shot = db.runs.screenshot(id(req));
  shot ? res.type('jpeg').send(Buffer.from(shot)) : res.sendStatus(404);
});

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }, done) => {
    const error = access.checkUpgrade(req);
    if (error) done(false, 403, error);
    else done(true);
  },
});

// เปิด browser ครั้งเดียว แล้วแยก context ต่อ 1 การเชื่อมต่อ
// ทุก request ของเบราว์เซอร์ผ่าน proxy ที่กันการเข้าถึงเครือข่ายภายใน (SSRF)
const urlGuard = createUrlGuard({ appPort: PORT });
const guardProxy = await startGuardProxy(urlGuard);
const browser = await chromium.launch({ headless: true, ...guardProxy.launchOptions });

// ตรวจก่อนเปิด URL เพื่อแจ้งเหตุผลเป็นภาษาไทย (proxy ยังกันซ้ำอีกชั้น)
async function assertUrlAllowed(url) {
  const verdict = await urlGuard.check(url);
  if (!verdict.ok) throw new Error(verdict.reason);
}

wss.on('connection', (ws) => {
  const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  let page;
  let context;

  // เทสเคสที่เปิดอยู่และสถานะของ recorder
  let currentTest = null; // { id, projectId }
  let steps = [];
  let nextId = 1;
  let recording = false;
  let mode = 'interact'; // interact | assertVisible | assertText | pick
  let running = false;
  let suppressMouseUp = false; // mousedown ที่ไม่ได้ส่งไปหน้าเว็บ (assert/pick/select) ต้องไม่ส่ง mouseup ด้วย
  let pendingSelect = null; // dropdown ที่รอผู้ใช้เลือกจากเมนูฝั่งเรา
  let fillTarget = null; // ช่องที่กำลังพิมพ์ เพื่อรวมการพิมพ์ต่อเนื่องเป็น fill step เดียว
  let health = {}; // stepId -> { runs, healed, failed } จากการรันล่าสุด
  let aiBusy = false;
  let aiPending = []; // step ที่ AI สร้าง รอผู้ใช้เลือกเพิ่ม

  // ต้องผูก listener ทันที ไม่งั้นข้อความที่มาก่อน browser พร้อมจะหาย
  // ทุกข้อความรอ setup เสร็จก่อน และประมวลผลตามลำดับ (mousedown/mouseup ไม่สลับกัน)
  let queue = setup().catch((err) => send({ type: 'error', message: err.message }));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    queue = queue
      .then(() => handle(msg))
      .catch((err) => send({ type: 'error', message: err.message }));
  });

  ws.on('close', () => {
    queue.finally(() => context?.close().catch(() => {}));
  });

  async function setup() {
    await openBrowserContext();
    send({ type: 'ready', viewport: VIEWPORT, actions: ACTIONS, locatorTypes: LOCATOR_TYPES });
    sendState();
  }

  // สร้าง context ใหม่ (cookie/storage สะอาด) แทนตัวเดิม ใช้ตอนเริ่มและก่อนรันเทสทุกครั้ง
  async function openBrowserContext() {
    const old = context;
    context = await browser.newContext({ viewport: VIEWPORT });
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    fillTarget = null;
    pendingSelect = null;

    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      send({ type: 'frame', data });
      // ต้อง ack ทุกเฟรม ไม่งั้น Chromium จะหยุดส่งเฟรมถัดไป
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
    });

    const current = page;
    current.on('framenavigated', (frame) => {
      if (frame === current.mainFrame()) send({ type: 'url', url: frame.url() });
    });
    await old?.close().catch(() => {});
  }

  // ข้อมูลเทสอื่นในโปรเจกต์ ใช้แสดงชื่อ/จำนวน step ของ block (useTest)
  function testContext() {
    const list = currentTest ? db.tests.list(currentTest.projectId) : [];
    const byId = new Map(list.map((t) => [t.id, t]));
    return { testName: (id) => byId.get(id)?.name, testStepCount: (id) => byId.get(id)?.step_count };
  }

  // Locator health: นับจากการรันล่าสุดว่าแต่ละ step ต้องซ่อมอัตโนมัติหรือพังกี่ครั้ง
  function computeHealth() {
    health = {};
    if (!currentTest) return;
    for (const results of db.runs.recentResults(currentTest.id)) {
      for (const r of results) {
        if (r.status !== 'passed' && r.status !== 'failed') continue;
        const h = (health[r.stepId] ??= { runs: 0, healed: 0, failed: 0 });
        h.runs++;
        if (r.healed?.length) h.healed++;
        if (r.status === 'failed') h.failed++;
      }
    }
  }

  function sendState() {
    const ctx = testContext();
    send({
      type: 'state',
      testId: currentTest?.id ?? null,
      recording,
      mode,
      running,
      health,
      steps: steps.map((s) => ({
        ...s,
        label: describeStep(s, ctx),
        parts: describeParts(s, ctx),
        code: stepToCode(s, ctx),
        complete: isComplete(s),
      })),
    });
  }

  function changed() {
    if (currentTest) db.tests.saveSteps(currentTest.id, steps);
    sendState();
  }

  function addStep(step) {
    step.id = nextId++;
    steps.push(step);
    fillTarget = null;
    changed();
    return step;
  }

  function setMode(next) {
    mode = next;
    if (mode === 'interact' && !recording) clearHighlight(page);
    sendState();
  }

  function newSecretName() {
    const used = new Set(steps.filter((s) => s.secret).map((s) => s.secret));
    for (let i = 1; ; i++) {
      const name = i === 1 ? 'TEST_PASSWORD' : `TEST_PASSWORD_${i}`;
      if (!used.has(name)) return name;
    }
  }

  // อัปเดต fill step จากค่าปัจจุบันของช่องที่ focus อยู่
  // ช่องรหัสผ่านเก็บค่าเป็นตัวแปรลับของโปรเจกต์ step เก็บแค่ชื่อตัวแปร
  async function recordFill() {
    const el = await focusedEditable(page);
    if (!el) return;
    const info = await inspect(el);
    const last = steps.at(-1);
    if (fillTarget && last?.id === fillTarget.stepId && (await el.evaluate((a, b) => a === b, fillTarget.el))) {
      if (last.secret) db.secrets.set(currentTest.projectId, last.secret, info.value);
      else last.value = info.value;
      changed();
      return;
    }
    const target = await targetFor(page, el);
    if (!target) return;
    let step;
    if (info.type === 'password') {
      const name = newSecretName();
      db.secrets.set(currentTest.projectId, name, info.value);
      step = addStep({ action: 'fill', ...target, secret: name });
    } else {
      step = addStep({ action: 'fill', ...target, value: info.value });
    }
    fillTarget = { el, stepId: step.id };
  }

  function findStep(stepId) {
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw new Error('ไม่พบ step นี้');
    return step;
  }

  async function handle(msg) {
    // ระหว่างรันเทส ไม่รับ input จากผู้ใช้ เพื่อไม่ให้รบกวนผล
    if (running && msg.type !== 'export') return;

    switch (msg.type) {
      case 'openTest': {
        const test = db.tests.get(msg.id);
        if (!test) throw new Error('ไม่พบเทสเคสนี้');
        currentTest = { id: test.id, projectId: test.project_id };
        steps = test.steps;
        nextId = Math.max(0, ...steps.map((s) => s.id ?? 0)) + 1;
        for (const s of steps) s.id ??= nextId++;
        recording = false;
        fillTarget = null;
        computeHealth();
        setMode('interact');
        break;
      }

      case 'navigate': {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(msg.url) ? msg.url : `https://${msg.url}`;
        await assertUrlAllowed(url);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (recording) addStep({ action: 'goto', value: page.url() });
        break;
      }
      case 'back':
        await page.goBack();
        break;
      case 'forward':
        await page.goForward();
        break;
      case 'reload':
        await page.reload();
        break;

      case 'mousemove':
        await page.mouse.move(msg.x, msg.y);
        if (recording || mode !== 'interact') await highlightAt(page, msg.x, msg.y, HIGHLIGHT_COLOR[mode]);
        break;
      case 'mousedown':
        await onMouseDown(msg);
        break;
      case 'mouseup':
        if (suppressMouseUp) {
          suppressMouseUp = false;
          break;
        }
        await page.mouse.move(msg.x, msg.y);
        await page.mouse.up({ button: msg.button });
        break;
      case 'wheel':
        await page.mouse.move(msg.x, msg.y);
        await page.mouse.wheel(msg.deltaX, msg.deltaY);
        break;

      case 'press': {
        // ปุ่มพิเศษ เช่น Enter, Backspace, ArrowLeft, Control+a
        let pressStep = null;
        if (recording && RECORDED_KEYS.has(msg.key)) {
          // หา locator ก่อนกด เพราะ Enter อาจทำให้หน้าเปลี่ยน
          const el = await focusedEditable(page);
          const target = el && (await targetFor(page, el));
          pressStep = { action: 'press', key: msg.key, ...target };
        }
        await page.keyboard.press(msg.key);
        if (pressStep) addStep(pressStep);
        else if (recording) await recordFill(); // Backspace, Delete, Ctrl+X ฯลฯ เปลี่ยนค่าในช่อง
        break;
      }
      case 'text':
        // ข้อความที่พิมพ์ได้ทั้งหมด (รวมภาษาไทย/IME) ส่งเป็นก้อนผ่าน insertText
        await page.keyboard.insertText(msg.text);
        if (recording) await recordFill();
        break;

      case 'selectChoose': {
        if (!pendingSelect) break;
        const { el, target, options } = pendingSelect;
        pendingSelect = null;
        await el.selectOption(msg.value);
        const option = options.find((o) => o.value === msg.value);
        if (recording && target) addStep({ action: 'selectOption', ...target, value: msg.value, label: option?.label });
        break;
      }
      case 'selectCancel':
        pendingSelect = null;
        break;

      case 'record':
        if (!currentTest) throw new Error('กรุณาเลือกเทสเคสก่อน');
        recording = !!msg.on;
        if (recording && steps.length === 0 && page.url() !== 'about:blank')
          addStep({ action: 'goto', value: page.url() });
        if (!recording && mode === 'interact') await clearHighlight(page);
        sendState();
        break;
      case 'mode':
        if (msg.mode === 'assertURL') {
          addStep({ action: 'assertURL', expected: page.url() });
          setMode('interact');
        } else {
          setMode(mode === msg.mode ? 'interact' : msg.mode);
        }
        break;

      // ---------- Step Editor ----------
      case 'insertStep': {
        const step = addStep(blankStep(msg.action));
        send({ type: 'stepAdded', id: step.id });
        break;
      }
      case 'updateStep': {
        const old = findStep(msg.id);
        const clean = sanitizeStep(msg.step);
        // ชื่อตัวเลือก dropdown ใช้แสดงผลเท่านั้น ถ้าค่าเปลี่ยนชื่อเดิมจะผิด
        if (clean.action === 'selectOption' && clean.value !== old.value) delete clean.label;
        if (clean.action === 'useTest' && clean.testId === currentTest.id) throw new Error('ใช้เทสนี้ซ้ำในตัวเองไม่ได้');
        if (clean.secret && msg.secretValue) db.secrets.set(currentTest.projectId, clean.secret, msg.secretValue);
        steps[steps.indexOf(old)] = { ...clean, id: old.id };
        fillTarget = null;
        changed();
        break;
      }
      case 'moveStep': {
        const from = steps.indexOf(findStep(msg.id));
        const [step] = steps.splice(from, 1);
        steps.splice(Math.max(0, Math.min(msg.to, steps.length)), 0, step);
        fillTarget = null;
        changed();
        break;
      }
      case 'deleteStep':
        steps = steps.filter((s) => s.id !== msg.id);
        fillTarget = null;
        changed();
        break;
      case 'clearSteps':
        steps = [];
        fillTarget = null;
        changed();
        break;
      case 'testLocator': {
        const { locator } = sanitizeStep({ action: 'click', locator: msg.locator });
        if (!locator) throw new Error('กรุณาระบุ locator');
        try {
          send({ type: 'locatorTest', count: await highlightLocator(page, locator) });
        } catch (err) {
          send({ type: 'locatorTest', error: err.message.split('\n')[0] });
        }
        break;
      }
      case 'clearHighlight':
        await clearHighlight(page);
        break;
      case 'acceptHeal':
        acceptHeal(msg);
        break;

      // ---------- AI สร้าง step ----------
      case 'aiGenerate':
        await startAiGenerate(String(msg.instruction ?? '').trim());
        break;
      case 'aiAccept': {
        const picked = (msg.indexes ?? []).map((i) => aiPending[i]).filter(Boolean);
        aiPending = [];
        for (const step of picked) addStep(structuredClone(step));
        break;
      }

      case 'run':
        await runAll();
        break;
      case 'export': {
        const name = (currentTest && db.tests.get(currentTest.id)?.name) || 'Recorded test';
        send({ type: 'export', code: exportTest(name, steps, (id) => db.tests.get(id), currentTest?.id), json: exportJson(name, steps) });
        break;
      }
    }
  }

  async function onMouseDown(msg) {
    await page.mouse.move(msg.x, msg.y);
    const el = await elementAt(page, msg.x, msg.y);
    const info = el && (await inspect(el));
    const target = el && (await targetFor(page, el));
    const locator = target?.locator;
    send({ type: 'element', code: locator ? locatorToCode(locator) : null });

    // โหมดเลือก element ให้ Step Editor: ส่ง locator กลับไปใส่ในฟอร์ม ไม่ส่งคลิกไปหน้าเว็บ
    if (mode === 'pick') {
      suppressMouseUp = true;
      if (target) send({ type: 'picked', ...target, text: info.text.slice(0, 100) });
      else send({ type: 'error', message: 'หา locator ที่ไม่ซ้ำของ element นี้ไม่ได้' });
      setMode('interact');
      return;
    }

    // โหมด Assert: คลิกเพื่อเลือก element ไม่ส่งคลิกไปหน้าเว็บ
    if (mode !== 'interact') {
      suppressMouseUp = true;
      if (!locator) {
        send({ type: 'error', message: 'หา locator ที่ไม่ซ้ำของ element นี้ไม่ได้' });
      } else if (mode === 'assertText' && info.text) {
        const textFree = (await targetFor(page, el, { avoidText: true })) || target;
        addStep({ action: 'assertText', ...textFree, expected: info.text.slice(0, 100) });
      } else {
        addStep({ action: 'assertVisible', ...target });
      }
      setMode('interact');
      return;
    }

    // dropdown แบบ native วาดโดย OS จึงไม่ปรากฏใน screencast ต้องแสดงเมนูเองฝั่งเรา
    if (info?.tag === 'select' && !info.multiple) {
      suppressMouseUp = true;
      pendingSelect = { el, target, options: info.options };
      send({ type: 'selectOpen', x: msg.x, y: msg.y, options: info.options });
      return;
    }

    // ช่องพิมพ์ข้อความไม่ต้องบันทึกคลิก เพราะ fill จะ focus ให้เอง
    if (recording && locator && !info.editable) {
      const isToggle = info.tag === 'input' && (info.type === 'checkbox' || info.type === 'radio');
      const action = isToggle ? (info.type === 'checkbox' && info.checked ? 'uncheck' : 'check') : 'click';
      addStep({ action, ...target });
    }
    await page.mouse.down({ button: msg.button });
  }

  // ถ่าย snapshot ของหน้าปัจจุบัน แล้วเรียก Gemini นอกคิวข้อความ เพื่อไม่ให้หน้าจอค้างระหว่างรอ
  async function startAiGenerate(instruction) {
    if (!instruction) return send({ type: 'aiError', message: 'กรุณาพิมพ์สิ่งที่ต้องการให้เทสทำ' });
    if (aiBusy) return;
    aiBusy = true;
    const ctx = testContext();
    const request = {
      instruction,
      url: page.url(),
      title: await page.title().catch(() => ''),
      snapshot: redactSnapshot(await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '')),
      existingSteps: steps.map((s) => describeStep(s, ctx)),
    };
    generateSteps(request)
      .then((result) => {
        // ตรวจกับหน้าเว็บจริงต้องทำในคิว เพราะใช้ page ร่วมกับการกระทำอื่น
        queue = queue.then(() => verifyAiResult(result)).catch((err) => send({ type: 'aiError', message: err.message }));
      })
      .catch((err) => send({ type: 'aiError', message: err.message }))
      .finally(() => {
        aiBusy = false;
      });
  }

  // ตรวจทุก step ที่ AI สร้างกับหน้าเว็บที่เปิดอยู่ และเติม locator สำรองให้ step ที่เจอ element
  async function verifyAiResult({ model, explanation, steps: generated }) {
    const ctx = testContext();
    aiPending = [];
    const items = [];
    for (const g of generated) {
      if (!g.step) {
        items.push({ check: 'invalid', action: g.raw?.action, error: g.error, label: `${ACTIONS[g.raw?.action]?.label ?? g.raw?.action ?? '?'} (ข้อมูลไม่ครบ)` });
        continue;
      }
      const step = g.step;
      let check = step.locator ? 'notFound' : 'noLocator';
      if (step.locator) {
        try {
          const L = toLocator(page, step.locator);
          const count = await L.count();
          if (count > 1) check = 'ambiguous';
          if (count === 1) {
            check = 'verified';
            const target = await targetFor(page, await L.elementHandle());
            if (target) {
              const same = (a) => JSON.stringify(a) === JSON.stringify(step.locator);
              const fallbacks = [target.locator, ...(target.fallbacks ?? [])].filter((f) => !same(f)).slice(0, 4);
              if (fallbacks.length) step.fallbacks = fallbacks;
              step.fingerprint = target.fingerprint;
            }
          }
        } catch {
          check = 'notFound';
        }
      }
      items.push({ index: aiPending.length, action: step.action, check, label: describeStep(step, ctx), parts: describeParts(step, ctx), code: stepToCode(step, ctx) });
      aiPending.push(step);
    }
    send({ type: 'aiResult', model, explanation, items });
  }

  // ผู้ใช้ยืนยันการซ่อม: ใช้ locator สำรองที่ได้ผลเป็นตัวหลักแทน (step อาจอยู่ในเทสอื่นที่ใช้เป็น block)
  function acceptHeal({ testId, stepId, locator }) {
    const apply = (list) => {
      const step = list.find((s) => s.id === stepId);
      if (!step?.locator) throw new Error('ไม่พบ step ที่ต้องอัปเดต');
      const clean = sanitizeStep({ ...step, locator, fallbacks: step.fallbacks });
      const same = (a) => JSON.stringify(a) === JSON.stringify(clean.locator);
      // ตัวหลักเดิมพังแล้วจึงตัดทิ้ง ส่วนตัวสำรองที่เหลือเก็บไว้ใช้ครั้งหน้า
      step.locator = clean.locator;
      step.fallbacks = (clean.fallbacks ?? []).filter((f) => !same(f));
      if (!step.fallbacks.length) delete step.fallbacks;
    };
    if (testId === currentTest?.id) {
      apply(steps);
      changed();
    } else {
      const other = db.tests.get(testId);
      if (!other) throw new Error('ไม่พบเทสที่ต้องอัปเดต');
      apply(other.steps);
      db.tests.saveSteps(testId, other.steps);
    }
    send({ type: 'healAccepted', testId, stepId });
  }

  const friendlyError = (err) =>
    err.name === 'TimeoutError'
      ? 'หา element ไม่เจอ หรือ element ยังไม่พร้อมใช้งานภายใน 5 วินาที'
      : err.message.split('\n')[0];

  // รัน step หนึ่งตัว (ขยาย block ซ้อนได้) คืนรายการ step ที่ถูกซ่อมอัตโนมัติ
  async function execStep(step, testId, stack, ctx) {
    if (step.action !== 'useTest') {
      const { healed } = await runStep(page, step, { secrets: ctx.secrets, checkUrl: assertUrlAllowed });
      return healed ? [{ testId, stepId: step.id, locator: healed, label: describeStep(step, ctx) }] : [];
    }
    const block = step.testId && db.tests.get(step.testId);
    if (!block) throw new Error('ไม่พบเทสที่ใช้ซ้ำ (อาจถูกลบไปแล้ว)');
    if (stack.includes(block.id) || stack.length > 5) throw new Error(`"${block.name}" ถูกใช้ซ้ำวนกันเอง`);
    const healed = [];
    for (const [i, inner] of block.steps.entries()) {
      try {
        healed.push(...(await execStep(inner, block.id, [...stack, block.id], ctx)));
      } catch (err) {
        throw new Error(`step ${i + 1} ใน "${block.name}": ${friendlyError(err)}`);
      }
    }
    return healed;
  }

  async function runAll() {
    if (!currentTest || steps.length === 0) return;
    running = true;
    recording = false;
    mode = 'interact';
    sendState();
    send({ type: 'runStart' });

    // เริ่มจาก context ใหม่ทุกครั้ง ให้ผลไม่ขึ้นกับ cookie/สถานะที่ค้างจากตอนบันทึก
    await openBrowserContext();
    const ctx = { ...testContext(), secrets: db.secrets.values(currentTest.projectId) };
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const results = [];
    let screenshot = null;
    let failed = false;

    for (const step of steps) {
      const result = { stepId: step.id, label: describeStep(step, ctx) };
      results.push(result);
      if (failed) {
        result.status = 'skipped';
        send({ type: 'runStep', id: step.id, status: 'skipped' });
        continue;
      }
      send({ type: 'runStep', id: step.id, status: 'running' });
      const t0 = Date.now();
      try {
        const healed = await execStep(step, currentTest.id, [currentTest.id], ctx);
        result.status = 'passed';
        if (healed.length) result.healed = healed;
      } catch (err) {
        failed = true;
        result.status = 'failed';
        result.error = friendlyError(err);
        screenshot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null);
      }
      result.ms = Date.now() - t0;
      send({ type: 'runStep', id: step.id, ...result });
    }

    const durationMs = Date.now() - started;
    const runId = db.runs.create({
      testId: currentTest.id,
      startedAt,
      durationMs,
      passed: !failed,
      results,
      screenshot,
    });
    const healedCount = results.reduce((n, r) => n + (r.healed?.length ?? 0), 0);
    running = false;
    computeHealth();
    send({ type: 'runDone', passed: !failed, ms: durationMs, runId, hasScreenshot: !!screenshot, healedCount });
    sendState();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Test Studio PoC running at http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  await browser.close();
  guardProxy.close();
  process.exit(0);
});
