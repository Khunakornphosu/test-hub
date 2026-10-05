// ข้อมูลช่วยหาสาเหตุเมื่อเทสพัง: Playwright trace และคำอธิบายสาเหตุ (กฎจากข้อความ error แล้วให้ AI อธิบายเพิ่มถ้าตั้งค่าไว้)
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aiStatus, classifyFailure, explainFailure, type FailureAnalysis } from '@test-studio/core';
import type { BrowserContext } from 'playwright';
import type { RunOutcome } from './executor.js';

/** trace ใหญ่เกินนี้ไม่เก็บ (หน้าเว็บหนักๆ ที่รันนาน) */
const MAX_TRACE_BYTES = 40 * 1024 * 1024;
const AI_TIMEOUT_MS = 25_000;

export async function startTrace(context: BrowserContext): Promise<void> {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
}

/** หยุด trace: เก็บไฟล์เฉพาะตอนพัง (keep) ไม่งั้นทิ้ง คืน null ถ้าไม่เก็บหรือใหญ่เกิน */
export async function stopTrace(context: BrowserContext, keep: boolean): Promise<Buffer | null> {
  if (!keep) {
    await context.tracing.stop().catch(() => {});
    return null;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'ts-trace-'));
  try {
    const file = path.join(dir, 'trace.zip');
    await context.tracing.stop({ path: file });
    const data = await readFile(file);
    return data.length <= MAX_TRACE_BYTES ? data : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** สาเหตุที่น่าจะเป็น: AI ใช้ภาพหน้าจอ+หน้าเว็บตอนพัง ถ้า AI ใช้ไม่ได้ก็ใช้กฎจากข้อความ error */
export async function analyzeFailure(outcome: RunOutcome, testName: string, stepLabels: string[]): Promise<FailureAnalysis | null> {
  const failure = outcome.failure;
  if (!failure) return null;
  const rules = classifyFailure(failure.error);
  if (!aiStatus().enabled) return rules;
  try {
    return await Promise.race([
      explainFailure({ testName, steps: stepLabels, failedIndex: failure.index, error: failure.error, url: failure.url, title: failure.title, snapshot: failure.snapshot, screenshot: outcome.screenshot }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI ตอบช้าเกินไป')), AI_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn(`[insights] ให้ AI อธิบายสาเหตุไม่สำเร็จ ใช้การจัดหมวดจากข้อความ error แทน: ${(err as Error).message}`);
    return rules;
  }
}
