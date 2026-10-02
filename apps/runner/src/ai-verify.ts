// ตรวจ step ที่ AI สร้างกับหน้าเว็บที่เปิดอยู่ และเติม locator สำรองให้ step ที่เจอ element
import {
  ACTIONS,
  describeParts,
  describeStep,
  stepToCode,
  toLocator,
  type AiItem,
  type DescribeContext,
  type GeneratedStep,
  type Locator,
  type Step,
} from '@test-studio/core';
import type { Page } from 'playwright';
import { targetFor } from './recorder.js';

const MAX_FALLBACKS = 4;
const sameLocator = (a: Locator, b: Locator) => JSON.stringify(a) === JSON.stringify(b);

export async function verifyAiSteps(page: Page, generated: GeneratedStep[], ctx: DescribeContext): Promise<{ items: AiItem[]; pending: Step[] }> {
  const items: AiItem[] = [];
  const pending: Step[] = [];
  for (const g of generated) {
    if (!('step' in g)) {
      const action = g.raw?.action;
      items.push({ check: 'invalid', action, error: g.error, label: `${(action && ACTIONS[action as keyof typeof ACTIONS]?.label) ?? action ?? '?'} (ข้อมูลไม่ครบ)` });
      continue;
    }
    let step: Step = g.step;
    const locator = 'locator' in step ? step.locator : null;
    let check: AiItem['check'] = locator ? 'notFound' : 'noLocator';
    if (locator) {
      try {
        const L = toLocator(page, locator);
        const count = await L.count();
        if (count > 1) check = 'ambiguous';
        if (count === 1) {
          check = 'verified';
          const handle = await L.elementHandle();
          const target = handle && (await targetFor(page, handle));
          if (target) {
            const fallbacks = [target.locator, ...(target.fallbacks ?? [])].filter((f) => !sameLocator(f, locator)).slice(0, MAX_FALLBACKS);
            step = { ...step, ...(fallbacks.length ? { fallbacks } : {}), fingerprint: target.fingerprint } as Step;
          }
        }
      } catch {
        check = 'notFound';
      }
    }
    items.push({ index: pending.length, action: step.action, check, label: describeStep(step, ctx), parts: describeParts(step, ctx), code: stepToCode(step, ctx) });
    pending.push(step);
  }
  return { items, pending };
}
