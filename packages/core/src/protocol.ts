// ข้อความระหว่างหน้าเว็บ (Workspace) กับ runner ผ่าน WebSocket
// - ขาเข้า (หน้าเว็บ -> runner) เป็นข้อมูลจากภายนอก จึงตรวจทุกข้อความด้วย zod ก่อนใช้
// - ขาออก (runner -> หน้าเว็บ) เป็นชนิดข้อมูล TypeScript ให้หน้าเว็บใช้ร่วมกัน
import { z } from 'zod';
import type { Healed, RunStepResult } from './runs.js';
import type { StepParts } from './steps/describe.js';
import type { ActionSpec, ActionName, Fingerprint, LOCATOR_TYPES, Locator, Step } from './steps/types.js';
import { isActionName } from './steps/types.js';

export const VIEWPORT = { width: 1280, height: 720 } as const;

// ---------- หน้าเว็บ -> runner ----------

const coord = z.number().finite().min(0).max(10_000);
const button = z.enum(['left', 'middle', 'right']);
export const MODES = ['interact', 'assertVisible', 'assertText', 'assertURL', 'pick'] as const;
export type Mode = (typeof MODES)[number];

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('openTest'), id: z.number().int().positive() }),
  z.object({ type: z.literal('navigate'), url: z.string().min(1).max(2048) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
  z.object({ type: z.literal('reload') }),
  z.object({ type: z.literal('mousemove'), x: coord, y: coord }),
  z.object({ type: z.literal('mousedown'), x: coord, y: coord, button }),
  z.object({ type: z.literal('mouseup'), x: coord, y: coord, button }),
  z.object({ type: z.literal('wheel'), x: coord, y: coord, deltaX: z.number().finite(), deltaY: z.number().finite() }),
  z.object({ type: z.literal('press'), key: z.string().min(1).max(60) }),
  z.object({ type: z.literal('text'), text: z.string().max(10_000) }),
  z.object({ type: z.literal('selectChoose'), value: z.string().max(1000) }),
  z.object({ type: z.literal('selectCancel') }),
  z.object({ type: z.literal('record'), on: z.boolean() }),
  z.object({ type: z.literal('mode'), mode: z.enum(MODES) }),
  z.object({ type: z.literal('insertStep'), action: z.string().refine(isActionName, 'ไม่รู้จักประเภท step') }),
  // step ที่แก้ไขแล้วเป็น unknown ที่นี่ เพราะ runner ต้องผ่าน sanitizeStep (ข้อความ error ภาษาไทย) ก่อนเสมอ
  z.object({ type: z.literal('updateStep'), id: z.number().int(), step: z.unknown(), secretValue: z.string().max(10_000).optional() }),
  z.object({ type: z.literal('moveStep'), id: z.number().int(), to: z.number().int().min(0) }),
  z.object({ type: z.literal('deleteStep'), id: z.number().int() }),
  z.object({ type: z.literal('clearSteps') }),
  z.object({ type: z.literal('testLocator'), locator: z.unknown() }),
  z.object({ type: z.literal('selectOptions'), locator: z.unknown() }),
  z.object({ type: z.literal('clearHighlight') }),
  z.object({ type: z.literal('acceptHeal'), testId: z.number().int().positive(), stepId: z.number().int(), locator: z.unknown() }),
  z.object({ type: z.literal('aiGenerate'), instruction: z.string().max(2000) }),
  z.object({ type: z.literal('aiAccept'), indexes: z.array(z.number().int().min(0)).max(100) }),
  z.object({ type: z.literal('run') }),
  z.object({ type: z.literal('export') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** แปลงข้อความดิบ (JSON) เป็น ClientMessage คืน null ถ้าไม่ใช่ JSON หรือรูปแบบไม่ถูกต้อง */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

// ---------- runner -> หน้าเว็บ ----------

export interface Health {
  runs: number;
  healed: number;
  failed: number;
}

/** step ที่ส่งให้หน้าเว็บ: ข้อมูลจริงของ step + ส่วนที่ runner คำนวณไว้ให้แสดงผล */
export type StepView = Step & { label: string; parts: StepParts; code: string; complete: boolean };

export type AiCheck = 'verified' | 'notFound' | 'ambiguous' | 'noLocator' | 'invalid';
export interface AiItem {
  /** ลำดับของ step ที่ใช้ตอน aiAccept (ไม่มีถ้าใช้ไม่ได้) */
  index?: number;
  action?: string;
  check: AiCheck;
  label: string;
  parts?: StepParts;
  code?: string;
  error?: string;
}

export type ServerMessage =
  | { type: 'ready'; viewport: typeof VIEWPORT; actions: Record<ActionName, ActionSpec>; locatorTypes: typeof LOCATOR_TYPES }
  | { type: 'frame'; data: string }
  | { type: 'url'; url: string }
  | { type: 'state'; testId: number | null; recording: boolean; mode: Mode; running: boolean; health: Record<number, Health>; steps: StepView[] }
  | { type: 'stepAdded'; id: number }
  | { type: 'picked'; locator: Locator; fallbacks?: Locator[]; fingerprint?: Fingerprint; text: string }
  | { type: 'element'; code: string | null }
  | { type: 'locatorTest'; count?: number; error?: string }
  | { type: 'selectOptions'; options?: { value: string; label: string }[]; error?: string }
  | { type: 'selectOpen'; x: number; y: number; options: { value: string; label: string; selected: boolean }[] }
  | { type: 'runStart' }
  | ({ type: 'runStep'; id: number; status: 'running' | 'passed' | 'failed' | 'skipped' } & Partial<Omit<RunStepResult, 'status' | 'stepId'>>)
  | { type: 'runDone'; passed: boolean; ms: number; runId: number; hasScreenshot: boolean; healedCount: number }
  | { type: 'export'; code: string; json: string }
  | { type: 'healAccepted'; testId: number; stepId: number }
  | { type: 'aiResult'; model: string; explanation: string; items: AiItem[] }
  | { type: 'aiError'; message: string }
  | { type: 'error'; message: string };

export type { Healed };
