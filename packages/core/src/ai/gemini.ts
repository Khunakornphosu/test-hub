// สร้าง step จากภาษาคนด้วย Google Gemini API (ใช้ free tier ได้)
// ตั้งค่า GEMINI_API_KEY (และ GEMINI_MODEL ถ้าต้องการระบุรุ่นเอง) ผ่าน environment
import { sanitizeStep } from '../steps/sanitize.js';
import { ACTIONS, type Step } from '../steps/types.js';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT } from './prompt.js';

type Env = Record<string, string | undefined>;
// อ่านค่าตอนใช้งาน (ไม่ใช่ตอน import) เพราะ server อาจโหลด .env หลังจาก import โมดูลแล้ว
const env = (): Env => process.env;
/** GEMINI_API_BASE ใช้ชี้ไป proxy หรือ mock server ตอนทดสอบ */
const apiBase = () => env().GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com/v1beta';
const apiKey = () => env().GEMINI_API_KEY?.trim();
const configuredModel = () => env().GEMINI_MODEL?.trim() || null;
let autoModel: string | null = null;

export function aiStatus(): { enabled: boolean; provider: string; model: string | null } {
  return { enabled: !!apiKey(), provider: 'Google Gemini', model: configuredModel() ?? autoModel };
}

class RetryableError extends Error {
  readonly retryable = true;
}

interface GeminiError {
  error?: { message?: string };
}

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() ?? '' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError') throw new RetryableError('Gemini ตอบช้าเกิน 30 วินาที ลองใหม่อีกครั้ง');
    throw new Error(`เชื่อมต่อ Gemini ไม่ได้: ${e.message}`);
  }
  const data = (await res.json().catch(() => ({}))) as T & GeminiError;
  if (!res.ok) {
    const detail = data.error?.message ?? res.statusText;
    if (res.status === 400 && /api key/i.test(detail)) throw new Error('GEMINI_API_KEY ไม่ถูกต้อง');
    if (res.status === 403) throw new Error(`ไม่มีสิทธิ์ใช้ Gemini API: ${detail}`);
    if (res.status === 404) throw new Error(`ไม่พบรุ่นที่ระบุ — ตรวจค่า GEMINI_MODEL: ${detail}`);
    if (res.status === 503 || res.status === 500) throw new RetryableError('Gemini มีผู้ใช้งานมากชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่');
    if (res.status === 429) {
      throw new Error('เกินโควตาฟรีของ Gemini แล้ว — รอสักครู่แล้วลองใหม่ หรือตั้ง GEMINI_MODEL เป็นรุ่น flash-lite ที่โควตาสูงกว่า');
    }
    throw new Error(`Gemini API ตอบกลับ ${res.status}: ${detail}`);
  }
  return data;
}

// ชื่อรุ่นเปลี่ยนบ่อย จึงเลือกจากรายชื่อที่บัญชีนี้ใช้ได้จริง: รุ่น Flash ที่เสถียร เรียงจากใหม่สุด
// คืนหลายรุ่น เพื่อสลับไปรุ่นถัดไปได้เมื่อรุ่นแรกมีผู้ใช้มากชั่วคราว
let candidates: string[] | null = null;
async function modelCandidates(): Promise<string[]> {
  const configured = configuredModel();
  if (configured) return [configured];
  if (candidates) return candidates;
  const { models = [] } = await call<{ models?: { name: string; supportedGenerationMethods?: string[] }[] }>('models?pageSize=1000');
  const version = (name: string) => Number(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n))
    .sort((a, b) => version(b) - version(a));
  // ลำดับ: flash ใหม่สุด -> flash-lite ใหม่สุด -> flash รุ่นถัดไป
  // สลับไปตระกูล lite เพราะรุ่นในตระกูลเดียวกันมักมีผู้ใช้มากพร้อมกัน
  const flash = usable.filter((n) => !n.endsWith('-lite'));
  const lite = usable.filter((n) => n.endsWith('-lite'));
  const found = [flash[0], lite[0], flash[1]].filter((n): n is string => !!n);
  if (!found.length) throw new Error('ไม่พบรุ่น Gemini Flash ที่บัญชีนี้ใช้ได้ — ตั้ง GEMINI_MODEL เอง');
  candidates = found;
  autoModel = found[0]!;
  return found;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

// ลองรุ่นตามลำดับ แต่ละรุ่นลองซ้ำ 1 ครั้งเมื่อมีผู้ใช้มากชั่วคราว (503)
async function generateWithFallback(body: string): Promise<{ model: string; data: GenerateContentResponse }> {
  let lastError: unknown;
  for (const m of await modelCandidates()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await call<GenerateContentResponse>(`models/${m}:generateContent`, { method: 'POST', body });
        autoModel = m;
        return { model: m, data };
      } catch (err) {
        if (!(err instanceof RetryableError)) throw err;
        lastError = err;
        if (attempt === 0) await sleep(1500);
      }
    }
  }
  throw lastError;
}

/** รูปแบบ step ที่โมเดลตอบ (ยังไม่ผ่านการตรวจ) */
export interface RawAiStep {
  action?: string;
  target?: { by?: string; role?: string; name?: string; match?: string };
  url?: string;
  text?: string;
  option?: string;
  key?: string;
  expected?: string;
  secret?: string;
}

// ค่าที่ action ต้องมี (AI มักลืมหรือใส่ผิดช่อง จึงตรวจก่อนให้ผู้ใช้เลือก)
const REQUIRED: Record<string, [keyof RawAiStep, string]> = {
  goto: ['url', 'ไม่ได้ระบุ URL'],
  fill: ['text', 'ไม่ได้ระบุข้อความที่จะพิมพ์'],
  selectOption: ['option', 'ไม่ได้ระบุตัวเลือก'],
  press: ['key', 'ไม่ได้ระบุปุ่ม'],
  assertText: ['expected', 'ไม่ได้ระบุข้อความที่ต้องตรวจ'],
  assertCount: ['expected', 'ไม่ได้ระบุจำนวน'],
  assertURL: ['expected', 'ไม่ได้ระบุ URL ที่ต้องตรวจ'],
};

/** แปลง step จากโมเดลเป็น Step ที่ผ่านการตรวจแล้ว (โยน Error ภาษาไทยถ้าข้อมูลไม่ครบ) */
export function toStep(raw: RawAiStep): Step {
  const t = raw.target ?? {};
  let locator: Record<string, unknown> | null = null;
  if (t.by === 'role') locator = { type: 'role', role: t.role, ...(t.name && { name: t.name }) };
  else if (t.by && t.by !== 'none') locator = { type: t.by, value: t.match };
  const action = raw.action ?? '';
  if (ACTIONS[action as keyof typeof ACTIONS]?.locator === 'required' && !locator) throw new Error('ไม่ได้ระบุ element');

  const required = REQUIRED[action];
  const secret = action === 'fill' && raw.secret;
  if (required && !String(raw[required[0]] ?? '').trim() && !secret) throw new Error(required[1]);

  const value = ({ goto: raw.url, fill: raw.text, selectOption: raw.option } as Record<string, string | undefined>)[action];
  return sanitizeStep({ action, locator, value, key: raw.key, expected: raw.expected, secret });
}

export type GeneratedStep = { step: Step } | { error: string; raw: RawAiStep };

export interface GenerateStepsInput {
  instruction: string;
  url: string;
  title: string;
  /** ARIA snapshot ของหน้าปัจจุบัน (ผ่าน redactSnapshot แล้ว) */
  snapshot: string;
  /** คำอธิบาย step ที่มีอยู่แล้ว */
  existingSteps: string[];
}

export async function generateSteps(input: GenerateStepsInput): Promise<{ model: string; explanation: string; steps: GeneratedStep[] }> {
  if (!apiKey()) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY');
  const { instruction, url, title, snapshot, existingSteps } = input;
  const context = [
    `Current URL: ${url}`,
    `Page title: ${title}`,
    `Existing steps in this test (${existingSteps.length}):`,
    ...existingSteps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'ARIA snapshot of the current page:',
    '```yaml',
    snapshot,
    '```',
    '',
    `Instruction: ${instruction}`,
  ].join('\n');

  const { model, data } = await generateWithFallback(
    JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: context }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
    })
  );

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    const reason = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'ไม่ทราบสาเหตุ';
    throw new Error(`Gemini ไม่ได้ตอบกลับ (${reason})`);
  }
  let parsed: { explanation?: unknown; steps?: RawAiStep[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini ตอบกลับในรูปแบบที่อ่านไม่ได้ ลองใหม่อีกครั้ง');
  }
  const steps = (parsed.steps ?? []).map((raw): GeneratedStep => {
    try {
      return { step: toStep(raw) };
    } catch (err) {
      return { error: (err as Error).message, raw };
    }
  });
  return { model, explanation: String(parsed.explanation ?? ''), steps };
}
