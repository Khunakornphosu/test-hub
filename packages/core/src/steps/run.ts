// รัน step ด้วย Playwright (ส่วนที่ใช้ร่วมกันระหว่างตอนบันทึก/ทดสอบใน Workspace และตอนรันเทสจริง)
import type { Locator as PwLocator, Page } from 'playwright';
import { fingerprintInPage, fingerprintScore } from './fingerprint.js';
import { isComplete } from './sanitize.js';
import type { Locator, Step } from './types.js';

export const STEP_TIMEOUT = 5000;
// ถ้า locator หลักหาไม่เจอเกินเวลานี้ จึงเริ่มลองตัวสำรอง (กันกรณีหน้ายังโหลดไม่เสร็จ)
export const HEAL_GRACE = 1500;
// สัดส่วนลายนิ้วมือที่ต้องตรงกัน จึงจะยอมรับว่าเป็น element เดิม
export const HEAL_MIN_SCORE = 0.5;

export const SCRIPT_TIMEOUT = 10_000;

const cleanEvalError = (err: unknown): string =>
  ((err as Error).message ?? String(err)).split('\n')[0]!.replace(/^page\.evaluate:\s*/, '').replace(/^Error:\s*/, '');

/**
 * รันโค้ดของผู้ใช้ในหน้าเว็บ (ไม่ใช่ใน runner) เป็นตัว async function
 * return false = ไม่ผ่าน, throw = ไม่ผ่านพร้อมข้อความ, ค่าอื่นคืนเป็นข้อความสั้นๆ ไว้แสดงผล
 */
export async function runScript(page: Page, script: string, timeout = SCRIPT_TIMEOUT): Promise<{ value?: string }> {
  // ห่อไว้ในหน้าเว็บเพื่อแปลงผลลัพธ์เป็นข้อความเอง ค่าอย่าง DOM element ส่งกลับมาตรงๆ ไม่ได้
  const source = `(async () => {
  const result = await (async () => {
${script}
  })();
  if (result === false) return { failed: true };
  if (result === undefined) return {};
  let text;
  try { text = typeof result === 'string' ? result : JSON.stringify(result); } catch { text = String(result); }
  return { value: String(text ?? result).slice(0, 500) };
})()`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`โค้ดทำงานนานเกิน ${timeout / 1000} วินาที`)), timeout);
  });
  let out: { failed?: boolean; value?: string };
  try {
    out = await Promise.race([page.evaluate(source) as Promise<{ failed?: boolean; value?: string }>, timedOut]);
  } catch (err) {
    throw new Error(`โค้ดผิดพลาด: ${cleanEvalError(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (out.failed) throw new Error('โค้ดคืนค่า false (ไม่ผ่าน)');
  return out.value === undefined ? {} : { value: out.value };
}

export function toLocator(page: Page, loc: Locator): PwLocator {
  switch (loc.type) {
    case 'role':
      return loc.name != null
        ? page.getByRole(loc.role as Parameters<Page['getByRole']>[0], { name: loc.name, exact: true })
        : page.getByRole(loc.role as Parameters<Page['getByRole']>[0]);
    case 'label':
      return page.getByLabel(loc.value, { exact: true });
    case 'placeholder':
      return page.getByPlaceholder(loc.value, { exact: true });
    case 'testid':
      return page.getByTestId(loc.value);
    case 'text':
      return page.getByText(loc.value, { exact: true });
    case 'css':
      return page.locator(loc.value);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const normalize = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function poll(check: () => Promise<boolean>, message: () => string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(message());
    await sleep(100);
  }
}

interface Resolved {
  L: PwLocator;
  /** locator สำรองที่ใช้แทน (ไม่มี = ใช้ตัวหลักได้ปกติ) */
  healed?: Locator;
}

/** หา element ของ step: ใช้ locator หลักก่อน ถ้าหาไม่เจอให้ลองตัวสำรองที่ลายนิ้วมือยังตรง */
async function resolveTarget(page: Page, step: Step & { locator?: Locator | null }): Promise<Resolved> {
  const primary = toLocator(page, step.locator!);
  const { fallbacks, fingerprint } = step as { fallbacks?: Locator[]; fingerprint?: Parameters<typeof fingerprintScore>[0] };
  // assertCount นับจำนวนโดยตรง การ "ซ่อม" จะทำให้ความหมายเปลี่ยน
  if (!fallbacks?.length || !fingerprint || step.action === 'assertCount') return { L: primary };
  const start = Date.now();
  for (;;) {
    if ((await primary.count().catch(() => 0)) === 1) return { L: primary };
    if (Date.now() - start > HEAL_GRACE) {
      for (const fb of fallbacks) {
        const L = toLocator(page, fb);
        if ((await L.count().catch(() => 0)) !== 1) continue;
        const fp = await L.evaluate(fingerprintInPage).catch(() => null);
        if (fingerprintScore(fingerprint, fp) >= HEAL_MIN_SCORE) return { L, healed: fb };
      }
    }
    // หมดเวลาแล้วยังไม่เจอ ให้คำสั่งจริงทำงานกับตัวหลักต่อ เพื่อได้ error ตามปกติ
    if (Date.now() - start > STEP_TIMEOUT) return { L: primary };
    await sleep(100);
  }
}

export interface RunStepOptions {
  /** ค่าของตัวแปรลับ (ชื่อ -> ค่า) */
  secrets?: Record<string, string>;
  /** ตรวจ URL ก่อน goto: โยน Error พร้อมเหตุผลถ้าไม่อนุญาต */
  checkUrl?: (url: string) => Promise<void> | void;
  /** แปลง URL ของ step เปิดหน้าเว็บก่อนตรวจและเปิด (เช่น เปลี่ยนเป็นโดเมนของ environment) */
  resolveUrl?: (url: string) => string;
}

/**
 * รัน step เดียว คืนค่า { healed } ถ้าต้องใช้ locator สำรอง
 * step useTest ต้องให้ผู้เรียกขยายเอง เพราะต้องโหลดเทสอื่นจากฐานข้อมูล
 */
export async function runStep(page: Page, step: Step, { secrets = {}, checkUrl, resolveUrl }: RunStepOptions = {}): Promise<{ healed?: Locator }> {
  if (!isComplete(step)) {
    throw new Error(step.action === 'useTest' ? 'step นี้ยังไม่ได้เลือกเทส' : step.action === 'fillForm' ? 'กรุณาระบุ label ของทุกช่องในฟอร์ม' : step.action === 'script' ? 'step นี้ยังไม่ได้เขียนโค้ด' : 'step นี้ยังไม่ได้เลือก element');
  }
  const resolved = 'locator' in step && step.locator ? await resolveTarget(page, step) : null;
  const L = resolved?.L as PwLocator;
  const opts = { timeout: STEP_TIMEOUT };
  switch (step.action) {
    case 'goto': {
      const url = resolveUrl ? resolveUrl(step.value) : step.value;
      if (checkUrl) await checkUrl(url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      break;
    }
    case 'click':
      await L.click(opts);
      break;
    case 'check':
      await L.check(opts);
      break;
    case 'uncheck':
      await L.uncheck(opts);
      break;
    case 'fill': {
      const secret = step.secret;
      if (secret && secrets[secret] == null) throw new Error(`ยังไม่ได้ตั้งค่าตัวแปรลับ ${secret}`);
      await L.fill(secret ? secrets[secret]! : (step.value ?? ''), opts);
      break;
    }
    case 'fillForm':
      if (!step.fields.length) throw new Error('กรุณาเพิ่มช่องที่ต้องการกรอก');
      for (const field of step.fields) {
        const locator = field.locator ?? (field.label?.trim() ? { type: 'label' as const, value: field.label.trim() } : null);
        if (!locator) throw new Error('กรุณาเลือก element ของทุกช่องในฟอร์ม');
        await toLocator(page, locator).fill(field.value, opts);
      }
      break;
    case 'press':
      await (L ? L.press(step.key, opts) : page.keyboard.press(step.key));
      break;
    case 'selectOption':
      await L.selectOption(step.value, opts);
      break;
    case 'assertVisible':
      await L.waitFor({ state: 'visible', ...opts });
      break;
    case 'assertText': {
      let actual = '';
      await L.waitFor({ state: 'visible', ...opts });
      await poll(
        async () => {
          actual = normalize(await L.innerText({ timeout: 500 }));
          return actual.includes(normalize(step.expected));
        },
        () => `ข้อความไม่ตรง: คาดว่ามี "${step.expected}" แต่เจอ "${actual}"`
      );
      break;
    }
    case 'assertCount': {
      let actual = 0;
      await poll(
        async () => (actual = await L.count()) === Number(step.expected),
        () => `จำนวนไม่ตรง: คาดว่า ${step.expected} แต่เจอ ${actual}`
      );
      break;
    }
    case 'assertURL':
      await poll(
        async () => page.url() === step.expected,
        () => `URL ไม่ตรง: คาดว่า ${step.expected} แต่เป็น ${page.url()}`
      );
      break;
    case 'script':
      await runScript(page, step.script);
      break;
    case 'useTest':
      throw new Error('step "ใช้เทสอื่นซ้ำ" ต้องถูกขยายก่อนรัน');
  }
  return resolved?.healed ? { healed: resolved.healed } : {};
}
