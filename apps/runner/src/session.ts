// 1 Session = 1 การเชื่อมต่อของผู้ใช้ = เบราว์เซอร์ 1 context + สถานะของ recorder/editor
// ข้อความจากหน้าเว็บถูกประมวลผลทีละข้อความตามลำดับ (mousedown/mouseup จึงไม่สลับกัน)
import {
  ACTIONS,
  LOCATOR_TYPES,
  VIEWPORT,
  aiStatus,
  blankStep,
  describeParts,
  describeStep,
  exportJson,
  exportTest,
  generateSteps,
  isComplete,
  locatorToCode,
  parseClientMessage,
  redactSnapshot,
  sanitizeStep,
  stepToCode,
  toLocator,
  type ClientMessage,
  type DescribeContext,
  type ExportableTest,
  type Locator,
  type Mode,
  type ServerMessage,
  type Step,
  type UrlGuard,
} from '@test-studio/core';
import type { Store } from '@test-studio/db';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { verifyAiSteps } from './ai-verify.js';
import { computeHealth, runSteps, type StepWithId } from './executor.js';
import { clearHighlight, elementAt, focusedEditable, highlightAt, highlightLocator, inspect, targetFor, type ElementInfo, type Handle, type Target } from './recorder.js';

type ActiveMode = Exclude<Mode, 'assertURL'>;

const HIGHLIGHT_COLOR: Record<ActiveMode, string> = { interact: '#3b82f6', assertVisible: '#16a34a', assertText: '#16a34a', pick: '#eab308' };
// ปุ่มที่บันทึกเป็น step press (ปุ่มอื่น เช่น Tab/ลูกศร ไม่จำเป็นต่อการรันซ้ำ)
const RECORDED_KEYS = new Set(['Enter', 'Escape']);
const CONTEXT_TTL_MS = 2000;

export interface SessionDeps {
  store: Store;
  browser: Browser;
  urlGuard: UrlGuard;
  /** ผู้ใช้ที่เชื่อมต่อ (จาก token) ใช้บันทึก log */
  user?: string;
  send(message: ServerMessage): void;
  isOpen(): boolean;
}

interface PendingSelect {
  el: Handle;
  target: Target | null;
  options: NonNullable<ElementInfo['options']>;
}

const sameLocator = (a: Locator, b: Locator) => JSON.stringify(a) === JSON.stringify(b);

export class Session {
  private context: BrowserContext | null = null;
  private page!: Page;
  private cdp: CDPSession | null = null;
  private queue: Promise<void> = Promise.resolve();

  private currentTest: { id: number; projectId: number } | null = null;
  private steps: StepWithId[] = [];
  private nextId = 1;
  private recording = false;
  private mode: ActiveMode = 'interact';
  private running = false;
  private suppressMouseUp = false; // mousedown ที่ไม่ได้ส่งไปหน้าเว็บ (assert/pick/select) ต้องไม่ส่ง mouseup ด้วย
  private pendingSelect: PendingSelect | null = null; // dropdown ที่รอผู้ใช้เลือกจากเมนูฝั่งเรา
  private fillTarget: { el: Handle; stepId: number } | null = null; // ช่องที่กำลังพิมพ์ เพื่อรวมการพิมพ์ต่อเนื่องเป็น fill step เดียว
  private health: Awaited<ReturnType<typeof computeHealth>> = {};
  private aiBusy = false;
  private aiPending: Step[] = []; // step ที่ AI สร้าง รอผู้ใช้เลือกเพิ่ม
  private ctxCache: { at: number; byId: Map<number, { name: string; stepCount: number }> } | null = null;

  constructor(private readonly deps: SessionDeps) {}

  private get store() {
    return this.deps.store;
  }

  private send(message: ServerMessage) {
    if (this.deps.isOpen()) this.deps.send(message);
  }

  // ---------- วงจรชีวิต ----------

  /** เปิดเบราว์เซอร์แล้วบอกหน้าเว็บว่าพร้อม (ข้อความที่มาก่อนพร้อมจะรอในคิว ไม่หาย) */
  start(): void {
    this.enqueue(async () => {
      await this.openBrowserContext();
      this.send({ type: 'ready', viewport: VIEWPORT, actions: ACTIONS, locatorTypes: LOCATOR_TYPES, ai: aiStatus() });
      await this.sendState();
    });
  }

  /** รับข้อความดิบจาก WebSocket: ข้อความที่ไม่ใช่ JSON หรือรูปแบบผิดจะถูกทิ้ง */
  receive(raw: string): void {
    const message = parseClientMessage(raw);
    if (message) this.enqueue(() => this.handle(message));
  }

  async dispose(): Promise<void> {
    await this.queue.catch(() => {});
    await this.context?.close().catch(() => {});
    this.context = null;
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((err: unknown) => this.send({ type: 'error', message: (err as Error).message }));
  }

  // ---------- เบราว์เซอร์ ----------

  /** สร้าง context ใหม่ (cookie/storage สะอาด) แทนตัวเดิม ใช้ตอนเริ่มและก่อนรันเทสทุกครั้ง */
  private async openBrowserContext(): Promise<void> {
    const old = this.context;
    const context = await this.deps.browser.newContext({ viewport: VIEWPORT });
    // ฟังก์ชันที่ส่งเข้า evaluate() ถูกแปลงเป็นข้อความแล้วรันในหน้าเว็บ แต่ esbuild (tsx, vitest ฯลฯ) แทรกฟังก์ชันช่วย
    // __name ลงในโค้ดตอนแปลง ซึ่งหน้าเว็บไม่มี จึงต้องมีตัวแทนไว้ ไม่งั้นพังเฉพาะตอนใช้เครื่องมือเหล่านี้
    await context.addInitScript('window.__name = window.__name || ((fn) => fn);');
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    this.context = context;
    this.page = page;
    this.cdp = cdp;
    this.fillTarget = null;
    this.pendingSelect = null;

    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      this.send({ type: 'frame', data });
      // ต้อง ack ทุกเฟรม ไม่งั้น Chromium จะหยุดส่งเฟรมถัดไป
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.send({ type: 'url', url: frame.url() });
    });
    await old?.close().catch(() => {});
  }

  private async assertUrlAllowed(url: string): Promise<void> {
    const verdict = await this.deps.urlGuard.check(url);
    if (!verdict.ok) throw new Error(verdict.reason);
  }

  // ---------- สถานะที่ส่งให้หน้าเว็บ ----------

  /** ชื่อ/จำนวน step ของเทสอื่นในโปรเจกต์ ใช้แสดง block (useTest) แคชสั้นๆ เพราะถูกเรียกทุกครั้งที่ step เปลี่ยน */
  private async describeContext(force = false): Promise<DescribeContext> {
    if (!this.currentTest) return {};
    if (force || !this.ctxCache || Date.now() - this.ctxCache.at > CONTEXT_TTL_MS) {
      const list = await this.store.repos.tests.list(this.currentTest.projectId);
      this.ctxCache = { at: Date.now(), byId: new Map(list.map((t) => [t.id, { name: t.name, stepCount: t.stepCount }])) };
    }
    const { byId } = this.ctxCache;
    return { testName: (id) => byId.get(id)?.name, testStepCount: (id) => byId.get(id)?.stepCount };
  }

  private async sendState(): Promise<void> {
    const ctx = await this.describeContext();
    this.send({
      type: 'state',
      testId: this.currentTest?.id ?? null,
      recording: this.recording,
      mode: this.mode,
      running: this.running,
      health: this.health,
      steps: this.steps.map((s) => ({ ...s, label: describeStep(s, ctx), parts: describeParts(s, ctx), code: stepToCode(s, ctx), complete: isComplete(s) })),
    });
  }

  /** บันทึก step ลงฐานข้อมูลแล้วส่งสถานะใหม่ให้หน้าเว็บ */
  private async changed(): Promise<void> {
    if (this.currentTest) await this.store.repos.tests.saveSteps(this.currentTest.id, this.steps);
    await this.sendState();
  }

  private async addStep(step: Step): Promise<StepWithId> {
    const added = { ...step, id: this.nextId++ } as StepWithId;
    this.steps.push(added);
    this.fillTarget = null;
    await this.changed();
    return added;
  }

  private async setMode(next: ActiveMode): Promise<void> {
    this.mode = next;
    if (next === 'interact' && !this.recording) await clearHighlight(this.page);
    await this.sendState();
  }

  private requireTest() {
    if (!this.currentTest) throw new Error('กรุณาเลือกเทสเคสก่อน');
    return this.currentTest;
  }

  private findStepIndex(stepId: number): number {
    const index = this.steps.findIndex((s) => s.id === stepId);
    if (index < 0) throw new Error('ไม่พบ step นี้');
    return index;
  }

  private newSecretName(): string {
    const used = new Set(this.steps.flatMap((s) => (s.action === 'fill' && s.secret ? [s.secret] : [])));
    for (let i = 1; ; i++) {
      const name = i === 1 ? 'TEST_PASSWORD' : `TEST_PASSWORD_${i}`;
      if (!used.has(name)) return name;
    }
  }

  // ---------- ตัวจัดการข้อความ ----------

  private async handle(msg: ClientMessage): Promise<void> {
    // ผู้ใช้ปิดหน้าไปแล้ว: ทิ้งข้อความที่ค้างในคิว ไม่งั้นจะเกิด step ที่ผู้ใช้ไม่เห็น
    if (!this.deps.isOpen()) return;
    // ระหว่างรันเทส ไม่รับ input จากผู้ใช้ เพื่อไม่ให้รบกวนผล
    if (this.running && msg.type !== 'export') return;
    const page = this.page;

    switch (msg.type) {
      case 'openTest': {
        const test = await this.store.repos.tests.get(msg.id);
        if (!test) throw new Error('ไม่พบเทสเคสนี้');
        this.currentTest = { id: test.id, projectId: test.projectId };
        this.steps = test.steps.map((s) => ({ ...s })) as StepWithId[];
        this.nextId = Math.max(0, ...this.steps.map((s) => s.id ?? 0)) + 1;
        for (const s of this.steps) s.id ??= this.nextId++;
        this.recording = false;
        this.fillTarget = null;
        this.ctxCache = null;
        this.health = await computeHealth(this.store, test.id);
        await this.setMode('interact');
        break;
      }

      case 'navigate': {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(msg.url) ? msg.url : `https://${msg.url}`;
        await this.assertUrlAllowed(url);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (this.recording) await this.addStep({ action: 'goto', value: page.url() });
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
        if (this.recording || this.mode !== 'interact') await highlightAt(page, msg.x, msg.y, HIGHLIGHT_COLOR[this.mode]);
        break;
      case 'mousedown':
        await this.onMouseDown(msg.x, msg.y, msg.button);
        break;
      case 'mouseup':
        if (this.suppressMouseUp) {
          this.suppressMouseUp = false;
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
        let pressStep: Step | null = null;
        if (this.recording && RECORDED_KEYS.has(msg.key)) {
          // หา locator ก่อนกด เพราะ Enter อาจทำให้หน้าเปลี่ยน
          const el = await focusedEditable(page);
          const target = el && (await targetFor(page, el));
          pressStep = { action: 'press', key: msg.key, ...(target ?? {}) };
        }
        await page.keyboard.press(msg.key);
        if (pressStep) await this.addStep(pressStep);
        else if (this.recording) await this.recordFill(); // Backspace, Delete, Ctrl+X ฯลฯ เปลี่ยนค่าในช่อง
        break;
      }
      case 'text':
        // ข้อความที่พิมพ์ได้ทั้งหมด (รวมภาษาไทย/IME) ส่งเป็นก้อนผ่าน insertText
        await page.keyboard.insertText(msg.text);
        if (this.recording) await this.recordFill();
        break;

      case 'selectChoose': {
        const pending = this.pendingSelect;
        if (!pending) break;
        this.pendingSelect = null;
        await pending.el.selectOption(msg.value);
        const option = pending.options.find((o) => o.value === msg.value);
        if (this.recording && pending.target) {
          await this.addStep({ action: 'selectOption', ...pending.target, value: msg.value, ...(option ? { label: option.label } : {}) });
        }
        break;
      }
      case 'selectCancel':
        this.pendingSelect = null;
        break;

      case 'record':
        this.requireTest();
        this.recording = msg.on;
        if (this.recording && this.steps.length === 0 && page.url() !== 'about:blank') await this.addStep({ action: 'goto', value: page.url() });
        if (!this.recording && this.mode === 'interact') await clearHighlight(page);
        await this.sendState();
        break;
      case 'mode':
        if (msg.mode === 'assertURL') {
          await this.addStep({ action: 'assertURL', expected: page.url() });
          await this.setMode('interact');
        } else {
          await this.setMode(this.mode === msg.mode ? 'interact' : msg.mode);
        }
        break;

      // ---------- Step Editor ----------
      case 'insertStep': {
        const step = await this.addStep(blankStep(msg.action as Step['action']));
        this.send({ type: 'stepAdded', id: step.id });
        break;
      }
      case 'updateStep': {
        const test = this.requireTest();
        const index = this.findStepIndex(msg.id);
        const old = this.steps[index]!;
        const clean = sanitizeStep(msg.step);
        // ชื่อตัวเลือก dropdown ใช้แสดงผลเท่านั้น ถ้าค่าเปลี่ยนชื่อเดิมจะผิด
        const sentLabel = (msg.step as { label?: unknown } | null)?.label;
        if (clean.action === 'selectOption' && old.action === 'selectOption' && clean.value !== old.value && !sentLabel) delete clean.label;
        if (clean.action === 'useTest' && clean.testId === test.id) throw new Error('ใช้เทสนี้ซ้ำในตัวเองไม่ได้');
        if (clean.action === 'fill' && clean.secret && msg.secretValue) await this.store.repos.secrets.set(test.projectId, clean.secret, msg.secretValue);
        this.steps[index] = { ...clean, id: old.id } as StepWithId;
        this.fillTarget = null;
        await this.changed();
        break;
      }
      case 'moveStep': {
        const from = this.findStepIndex(msg.id);
        const [step] = this.steps.splice(from, 1);
        this.steps.splice(Math.max(0, Math.min(msg.to, this.steps.length)), 0, step!);
        this.fillTarget = null;
        await this.changed();
        break;
      }
      case 'deleteStep':
        this.steps = this.steps.filter((s) => s.id !== msg.id);
        this.fillTarget = null;
        await this.changed();
        break;
      case 'clearSteps':
        this.steps = [];
        this.fillTarget = null;
        await this.changed();
        break;
      case 'testLocator': {
        const step = sanitizeStep({ action: 'click', locator: msg.locator });
        const locator = 'locator' in step ? step.locator : null;
        if (!locator) throw new Error('กรุณาระบุ locator');
        try {
          this.send({ type: 'locatorTest', count: await highlightLocator(page, locator) });
        } catch (err) {
          this.send({ type: 'locatorTest', error: (err as Error).message.split('\n')[0]! });
        }
        break;
      }
      case 'selectOptions':
        this.send({ type: 'selectOptions', ...(await this.readSelectOptions(msg.locator)) });
        break;
      case 'clearHighlight':
        await clearHighlight(page);
        break;
      case 'acceptHeal':
        await this.acceptHeal(msg.testId, msg.stepId, msg.locator);
        break;

      // ---------- AI สร้าง step ----------
      case 'aiGenerate':
        await this.startAiGenerate(msg.instruction.trim());
        break;
      case 'aiAccept': {
        const picked = msg.indexes.map((i) => this.aiPending[i]).filter((s): s is Step => !!s);
        this.aiPending = [];
        for (const step of picked) await this.addStep(structuredClone(step));
        break;
      }

      case 'run':
        await this.runAll();
        break;
      case 'export': {
        const test = this.currentTest && (await this.store.repos.tests.get(this.currentTest.id));
        const name = test?.name || 'Recorded test';
        const blocks = await this.loadBlocks(this.steps);
        this.send({ type: 'export', code: exportTest(name, this.steps, (id) => blocks.get(id), this.currentTest?.id ?? null), json: exportJson(name, this.steps) });
        break;
      }
    }
  }

  /** โหลดเทสที่ถูกใช้ซ้ำเป็น block (รวมซ้อนกัน) ไว้ก่อน เพราะ exportTest เป็นฟังก์ชันที่ไม่รอฐานข้อมูล */
  private async loadBlocks(steps: Step[], found = new Map<number, ExportableTest>(), depth = 0): Promise<Map<number, ExportableTest>> {
    if (depth > 6) return found;
    for (const s of steps) {
      if (s.action !== 'useTest' || !s.testId || found.has(s.testId)) continue;
      const block = await this.store.repos.tests.get(s.testId);
      if (!block) continue;
      found.set(block.id, { id: block.id, name: block.name, steps: block.steps });
      await this.loadBlocks(block.steps, found, depth + 1);
    }
    return found;
  }

  // ---------- recorder ----------

  /**
   * อัปเดต fill step จากค่าปัจจุบันของช่องที่ focus อยู่ (รวมการพิมพ์ต่อเนื่องเป็น step เดียว)
   * ช่องรหัสผ่านเก็บค่าเป็นตัวแปรลับของโปรเจกต์ step เก็บแค่ชื่อตัวแปร
   */
  private async recordFill(): Promise<void> {
    const test = this.requireTest();
    const el = await focusedEditable(this.page);
    if (!el) return;
    const info = await inspect(el);
    const last = this.steps.at(-1);
    if (this.fillTarget && last?.id === this.fillTarget.stepId && last.action === 'fill' && (await el.evaluate((a, b) => a === b, this.fillTarget.el))) {
      if (last.secret) await this.store.repos.secrets.set(test.projectId, last.secret, info.value);
      else last.value = info.value;
      await this.changed();
      return;
    }
    const target = await targetFor(this.page, el);
    if (!target) return;
    let step: StepWithId;
    if (info.type === 'password') {
      const name = this.newSecretName();
      await this.store.repos.secrets.set(test.projectId, name, info.value);
      step = await this.addStep({ action: 'fill', ...target, secret: name });
    } else {
      step = await this.addStep({ action: 'fill', ...target, value: info.value });
    }
    this.fillTarget = { el, stepId: step.id };
  }

  private async onMouseDown(x: number, y: number, button: 'left' | 'middle' | 'right'): Promise<void> {
    const page = this.page;
    await page.mouse.move(x, y);
    const el = await elementAt(page, x, y);
    const info = el && (await inspect(el));
    const target = el && (await targetFor(page, el));
    const locator = target?.locator;
    this.send({ type: 'element', code: locator ? locatorToCode(locator) : null });

    // โหมดเลือก element ให้ Step Editor: ส่ง locator กลับไปใส่ในฟอร์ม ไม่ส่งคลิกไปหน้าเว็บ
    if (this.mode === 'pick') {
      this.suppressMouseUp = true;
      if (target && info) this.send({ type: 'picked', ...target, text: info.text.slice(0, 100) });
      else this.send({ type: 'error', message: 'หา locator ที่ไม่ซ้ำของ element นี้ไม่ได้' });
      await this.setMode('interact');
      return;
    }

    // โหมด Assert: คลิกเพื่อเลือก element ไม่ส่งคลิกไปหน้าเว็บ
    if (this.mode !== 'interact') {
      this.suppressMouseUp = true;
      if (!target || !el || !info) {
        this.send({ type: 'error', message: 'หา locator ที่ไม่ซ้ำของ element นี้ไม่ได้' });
      } else if (this.mode === 'assertText' && info.text) {
        const textFree = (await targetFor(page, el, { avoidText: true })) || target;
        await this.addStep({ action: 'assertText', ...textFree, expected: info.text.slice(0, 100) });
      } else {
        await this.addStep({ action: 'assertVisible', ...target });
      }
      await this.setMode('interact');
      return;
    }

    // dropdown แบบ native วาดโดย OS จึงไม่ปรากฏใน screencast ต้องแสดงเมนูเองฝั่งเรา
    if (el && info?.tag === 'select' && !info.multiple && info.options) {
      this.suppressMouseUp = true;
      this.pendingSelect = { el, target: target ?? null, options: info.options };
      this.send({ type: 'selectOpen', x, y, options: info.options });
      return;
    }

    // ช่องพิมพ์ข้อความไม่ต้องบันทึกคลิก เพราะ fill จะ focus ให้เอง
    if (this.recording && target && info && !info.editable) {
      const isToggle = info.tag === 'input' && (info.type === 'checkbox' || info.type === 'radio');
      const action = isToggle ? (info.type === 'checkbox' && info.checked ? 'uncheck' : 'check') : 'click';
      await this.addStep({ action, ...target });
    }
    await page.mouse.down({ button });
  }

  /** ตัวเลือกของ dropdown ในหน้าที่เปิดอยู่ ให้ Step Editor แสดงเป็นรายการ (ผู้ใช้ไม่ต้องรู้ value) */
  private async readSelectOptions(rawLocator: unknown): Promise<{ options?: { value: string; label: string }[]; error?: string }> {
    try {
      const step = sanitizeStep({ action: 'click', locator: rawLocator });
      const locator = 'locator' in step ? step.locator : null;
      if (!locator) return { error: 'ยังไม่ได้เลือก dropdown' };
      const L = toLocator(this.page, locator);
      const count = await L.count();
      if (count === 0) return { error: 'ไม่พบ dropdown นี้ในหน้าที่เปิดอยู่' };
      if (count > 1) return { error: `locator นี้เจอ ${count} ตัว` };
      const options = await L.evaluate((el) =>
        el.tagName === 'SELECT' ? [...(el as HTMLSelectElement).options].map((o) => ({ value: o.value, label: o.label || o.text })) : null
      );
      return options ? { options } : { error: 'element นี้ไม่ใช่ dropdown แบบ <select>' };
    } catch (err) {
      return { error: (err as Error).message.split('\n')[0]! };
    }
  }

  // ---------- AI ----------

  /** ถ่าย snapshot ของหน้าปัจจุบัน แล้วเรียก Gemini นอกคิวข้อความ เพื่อไม่ให้หน้าจอค้างระหว่างรอ */
  private async startAiGenerate(instruction: string): Promise<void> {
    if (!instruction) return this.send({ type: 'aiError', message: 'กรุณาพิมพ์สิ่งที่ต้องการให้เทสทำ' });
    if (this.aiBusy) return;
    this.aiBusy = true;
    const ctx = await this.describeContext();
    const page = this.page;
    const request = {
      instruction,
      url: page.url(),
      title: await page.title().catch(() => ''),
      snapshot: redactSnapshot(await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '')),
      existingSteps: this.steps.map((s) => describeStep(s, ctx)),
    };
    generateSteps(request)
      .then((result) => {
        // ตรวจกับหน้าเว็บจริงต้องทำในคิว เพราะใช้ page ร่วมกับการกระทำอื่น
        this.enqueue(async () => {
          const { items, pending } = await verifyAiSteps(this.page, result.steps, await this.describeContext());
          this.aiPending = pending;
          this.send({ type: 'aiResult', model: result.model, explanation: result.explanation, items });
        });
      })
      .catch((err: Error) => this.send({ type: 'aiError', message: err.message }))
      .finally(() => {
        this.aiBusy = false;
      });
  }

  // ---------- self-healing / รันเทส ----------

  /** ผู้ใช้ยืนยันการซ่อม: ใช้ locator สำรองที่ได้ผลเป็นตัวหลักแทน (step อาจอยู่ในเทสอื่นที่ใช้เป็น block) */
  private async acceptHeal(testId: number, stepId: number, rawLocator: unknown): Promise<void> {
    const apply = (list: StepWithId[]): void => {
      const index = list.findIndex((s) => s.id === stepId);
      const step = list[index];
      if (!step || !('locator' in step) || !step.locator) throw new Error('ไม่พบ step ที่ต้องอัปเดต');
      const clean = sanitizeStep({ ...step, locator: rawLocator, fallbacks: 'fallbacks' in step ? step.fallbacks : undefined });
      if (!('locator' in clean) || !clean.locator) throw new Error('locator ไม่ถูกต้อง');
      const newLocator = clean.locator;
      // ตัวหลักเดิมพังแล้วจึงตัดทิ้ง ส่วนตัวสำรองที่เหลือเก็บไว้ใช้ครั้งหน้า
      const fallbacks = ('fallbacks' in clean ? (clean.fallbacks ?? []) : []).filter((f) => !sameLocator(f, newLocator));
      const next = { ...step, locator: newLocator } as StepWithId & { fallbacks?: Locator[] };
      if (fallbacks.length) next.fallbacks = fallbacks;
      else delete next.fallbacks;
      list[index] = next;
    };
    if (testId === this.currentTest?.id) {
      apply(this.steps);
      await this.changed();
    } else {
      const other = await this.store.repos.tests.get(testId);
      if (!other) throw new Error('ไม่พบเทสที่ต้องอัปเดต');
      const list = other.steps as StepWithId[];
      apply(list);
      await this.store.repos.tests.saveSteps(testId, list);
    }
    this.send({ type: 'healAccepted', testId, stepId });
  }

  private async runAll(): Promise<void> {
    const test = this.currentTest;
    if (!test || this.steps.length === 0) return;
    this.running = true;
    this.recording = false;
    this.mode = 'interact';
    await this.sendState();
    this.send({ type: 'runStart' });

    try {
      // เริ่มจาก context ใหม่ทุกครั้ง ให้ผลไม่ขึ้นกับ cookie/สถานะที่ค้างจากตอนบันทึก
      await this.openBrowserContext();
      const ctx = {
        ...(await this.describeContext(true)),
        secrets: await this.store.repos.secrets.values(test.projectId),
        checkUrl: (url: string) => this.assertUrlAllowed(url),
      };
      const outcome = await runSteps(this.page, this.store, test.id, this.steps, ctx, { step: (e) => this.send({ type: 'runStep', ...e }) });
      const runId = await this.store.repos.runs.create({
        testId: test.id,
        startedAt: outcome.startedAt,
        durationMs: outcome.durationMs,
        passed: outcome.passed,
        results: outcome.results,
        screenshot: outcome.screenshot,
      });
      this.running = false;
      this.health = await computeHealth(this.store, test.id);
      this.send({ type: 'runDone', passed: outcome.passed, ms: outcome.durationMs, runId, hasScreenshot: !!outcome.screenshot, healedCount: outcome.healedCount });
    } finally {
      this.running = false;
    }
    await this.sendState();
  }
}

