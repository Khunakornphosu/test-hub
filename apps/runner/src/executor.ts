// รันเทสทั้งชุด: ขยาย block (useTest), เก็บผลรายสเต็ป, screenshot ตอนพัง และบันทึกประวัติ
import {
  describeStep,
  runStep,
  type DescribeContext,
  type Healed,
  type RunStepResult,
  type Step,
} from '@test-studio/core';
import type { Store } from '@test-studio/db';
import type { Page } from 'playwright';

export type StepWithId = Step & { id: number };

export interface ExecContext extends DescribeContext {
  secrets: Record<string, string>;
  /** ตรวจ URL ก่อนเปิด (โยน Error พร้อมเหตุผลถ้าไม่อนุญาต) */
  checkUrl: (url: string) => Promise<void>;
  resolveUrl?: (url: string) => string;
}

/** ข้อความ error ที่ผู้ใช้อ่านเข้าใจ (ตัดรายละเอียดทางเทคนิคของ Playwright ออก) */
export function friendlyError(err: unknown): string {
  const e = err as Error;
  return e.name === 'TimeoutError' ? 'หา element ไม่เจอ หรือ element ยังไม่พร้อมใช้งานภายใน 5 วินาที' : (e.message ?? String(err)).split('\n')[0]!;
}

const MAX_BLOCK_DEPTH = 5;

/** รัน step หนึ่งตัว (ขยาย block ซ้อนได้) คืนรายการ step ที่ถูกซ่อมอัตโนมัติ */
export async function execStep(page: Page, store: Store, step: Step & { id?: number }, testId: number, stack: number[], ctx: ExecContext): Promise<Healed[]> {
  if (step.action !== 'useTest') {
    const { healed } = await runStep(page, step, { secrets: ctx.secrets, checkUrl: ctx.checkUrl, resolveUrl: ctx.resolveUrl });
    return healed && step.id != null ? [{ testId, stepId: step.id, locator: healed, label: describeStep(step, ctx) }] : [];
  }
  const block = step.testId ? await store.repos.tests.get(step.testId) : null;
  if (!block) throw new Error('ไม่พบเทสที่ใช้ซ้ำ (อาจถูกลบไปแล้ว)');
  if (stack.includes(block.id) || stack.length > MAX_BLOCK_DEPTH) throw new Error(`"${block.name}" ถูกใช้ซ้ำวนกันเอง`);
  const healed: Healed[] = [];
  for (const [i, inner] of block.steps.entries()) {
    try {
      healed.push(...(await execStep(page, store, inner, block.id, [...stack, block.id], ctx)));
    } catch (err) {
      throw new Error(`step ${i + 1} ใน "${block.name}": ${friendlyError(err)}`);
    }
  }
  return healed;
}

export interface RunEvents {
  /** ความคืบหน้ารายสเต็ปสำหรับแสดงสดบนหน้าเว็บ */
  step(event: { id: number; status: 'running' | 'skipped' } | ({ id: number } & RunStepResult)): void;
}

export interface RunOutcome {
  passed: boolean;
  durationMs: number;
  results: RunStepResult[];
  screenshot: Buffer | null;
  healedCount: number;
  startedAt: Date;
}

/**
 * รัน step ของเทสตามลำดับ เจอ step แรกที่พังแล้วที่เหลือถูกข้าม
 * ผู้เรียกต้องเตรียม page ใหม่ (context สะอาด) มาให้
 */
export async function runSteps(page: Page, store: Store, testId: number, steps: StepWithId[], ctx: ExecContext, events: RunEvents): Promise<RunOutcome> {
  const startedAt = new Date();
  const started = Date.now();
  const results: RunStepResult[] = [];
  let screenshot: Buffer | null = null;
  let failed = false;

  for (const step of steps) {
    const label = describeStep(step, ctx);
    if (failed) {
      results.push({ stepId: step.id, label, status: 'skipped' });
      events.step({ id: step.id, status: 'skipped' });
      continue;
    }
    events.step({ id: step.id, status: 'running' });
    const t0 = Date.now();
    let result: RunStepResult;
    try {
      const healed = await execStep(page, store, step, testId, [testId], ctx);
      result = { stepId: step.id, label, status: 'passed', ...(healed.length ? { healed } : {}) };
    } catch (err) {
      failed = true;
      result = { stepId: step.id, label, status: 'failed', error: friendlyError(err) };
      screenshot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null);
    }
    result.ms = Date.now() - t0;
    results.push(result);
    events.step({ ...result, id: step.id });
  }

  return {
    passed: !failed,
    durationMs: Date.now() - started,
    results,
    screenshot,
    healedCount: results.reduce((n, r) => n + (r.healed?.length ?? 0), 0),
    startedAt,
  };
}

/** Locator health: นับจากการรันล่าสุดว่าแต่ละ step ต้องซ่อมอัตโนมัติหรือพังกี่ครั้ง */
export async function computeHealth(store: Store, testId: number): Promise<Record<number, { runs: number; healed: number; failed: number }>> {
  const health: Record<number, { runs: number; healed: number; failed: number }> = {};
  for (const results of await store.repos.runs.recentResults(testId)) {
    for (const r of results) {
      if (r.status !== 'passed' && r.status !== 'failed') continue;
      const h = (health[r.stepId] ??= { runs: 0, healed: 0, failed: 0 });
      h.runs++;
      if (r.healed?.length) h.healed++;
      if (r.status === 'failed') h.failed++;
    }
  }
  return health;
}
