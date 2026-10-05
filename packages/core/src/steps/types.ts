// แหล่งความจริงเดียวของรูปแบบ step: zod schema -> type ใช้ตรวจข้อมูลที่เข้า/ออกทุกจุด (ฟอร์ม, API, ฐานข้อมูล, ผลจาก AI)
import { z } from 'zod';

export const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/;
export const MAX_FALLBACKS = 4;

export const LOCATOR_TYPES = {
  role: 'Role',
  label: 'Label',
  placeholder: 'Placeholder',
  testid: 'Test ID',
  text: 'ข้อความ',
  css: 'CSS',
} as const;
export type LocatorType = keyof typeof LOCATOR_TYPES;

const value = z.string().min(1);
export const locatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), role: z.string().min(1), name: z.string().optional() }),
  z.object({ type: z.literal('label'), value }),
  z.object({ type: z.literal('placeholder'), value }),
  z.object({ type: z.literal('testid'), value }),
  z.object({ type: z.literal('text'), value }),
  z.object({ type: z.literal('css'), value }),
]);
export type Locator = z.infer<typeof locatorSchema>;

// ลายนิ้วมือของ element ตอนบันทึก ใช้ยืนยันตอน self-healing (ค่าจากหน้าเว็บอาจเป็น null จึงรับ nullish)
export const FINGERPRINT_KEYS = ['tag', 'type', 'id', 'name', 'role', 'ariaLabel', 'placeholder', 'testId', 'text'] as const;
export type FingerprintKey = (typeof FINGERPRINT_KEYS)[number];
export const fingerprintSchema = z.object({
  tag: z.string(),
  type: z.string().nullish(),
  id: z.string().nullish(),
  name: z.string().nullish(),
  role: z.string().nullish(),
  ariaLabel: z.string().nullish(),
  placeholder: z.string().nullish(),
  testId: z.string().nullish(),
  text: z.string().nullish(),
});
export type Fingerprint = z.infer<typeof fingerprintSchema>;

const id = { id: z.number().int().optional() };
// locator = null หมายถึงยังไม่ได้เลือก element (เช่น step ที่เพิ่งกด "เพิ่ม step")
const target = {
  locator: locatorSchema.nullable(),
  fallbacks: z.array(locatorSchema).max(MAX_FALLBACKS).optional(),
  fingerprint: fingerprintSchema.optional(),
};
const secretName = z.string().regex(SECRET_NAME);

export const stepSchema = z.discriminatedUnion('action', [
  z.object({ ...id, action: z.literal('goto'), value: z.string() }),
  z.object({ ...id, action: z.literal('click'), ...target }),
  z.object({ ...id, action: z.literal('check'), ...target }),
  z.object({ ...id, action: z.literal('uncheck'), ...target }),
  z.object({ ...id, action: z.literal('fill'), ...target, value: z.string().optional(), secret: secretName.optional() }),
  z.object({ ...id, action: z.literal('fillForm'), fields: z.array(z.object({ locator: locatorSchema.nullable().optional(), label: z.string().optional(), value: z.string() })).max(30) }),
  z.object({
    ...id,
    action: z.literal('press'),
    key: z.string(),
    locator: locatorSchema.nullable().optional(),
    fallbacks: target.fallbacks,
    fingerprint: target.fingerprint,
  }),
  z.object({ ...id, action: z.literal('selectOption'), ...target, value: z.string(), label: z.string().optional() }),
  z.object({ ...id, action: z.literal('useTest'), testId: z.number().int().positive().nullable() }),
  z.object({ ...id, action: z.literal('assertVisible'), ...target }),
  z.object({ ...id, action: z.literal('assertText'), ...target, expected: z.string() }),
  z.object({ ...id, action: z.literal('assertCount'), ...target, expected: z.string().regex(/^\d+$/) }),
  z.object({ ...id, action: z.literal('assertURL'), expected: z.string() }),
]);
export type Step = z.infer<typeof stepSchema>;
export type ActionName = Step['action'];

export const testStepsSchema = z.array(stepSchema);

// ---------- ตารางอธิบายแต่ละประเภท step (ส่งให้หน้าเว็บสร้างฟอร์ม Step Editor) ----------

export interface ActionSpec {
  label: string;
  group: 'action' | 'assert';
  /** required = ต้องเลือก element, optional = ไม่บังคับ, ไม่มี = ไม่ใช้ element */
  locator?: 'required' | 'optional';
  /** ชื่อฟิลด์ -> ป้ายที่แสดงในฟอร์ม */
  fields?: Record<string, string>;
  hints?: Record<string, string>;
}

export const ACTIONS: Record<ActionName, ActionSpec> = {
  goto: { label: 'เปิดหน้าเว็บ', group: 'action', fields: { value: 'URL' } },
  click: { label: 'คลิก', group: 'action', locator: 'required' },
  fill: { label: 'พิมพ์ข้อความ', group: 'action', locator: 'required', fields: { value: 'ข้อความที่จะพิมพ์' } },
  fillForm: { label: 'กรอกฟอร์มหลายช่อง', group: 'action' },
  press: {
    label: 'กดปุ่มคีย์บอร์ด',
    group: 'action',
    locator: 'optional',
    fields: { key: 'ปุ่ม' },
    hints: { key: 'เช่น Enter, Tab, Escape, Control+a' },
  },
  selectOption: { label: 'เลือกจาก dropdown', group: 'action', locator: 'required', fields: { value: 'ตัวเลือก' } },
  check: { label: 'ติ๊ก checkbox', group: 'action', locator: 'required' },
  uncheck: { label: 'เอาติ๊กออก', group: 'action', locator: 'required' },
  useTest: {
    label: 'ใช้เทสอื่นซ้ำ (block)',
    group: 'action',
    fields: { testId: 'เทสที่ใช้ซ้ำ' },
    hints: { testId: 'ทุก step ของเทสนั้นจะรันตรงนี้ เช่น ใช้เทส Login ซ้ำในทุกเทส' },
  },
  assertVisible: { label: 'ตรวจว่าเห็น element', group: 'assert', locator: 'required' },
  assertText: {
    label: 'ตรวจข้อความ',
    group: 'assert',
    locator: 'required',
    fields: { expected: 'ต้องมีข้อความ' },
    hints: { expected: 'ผ่านถ้า element มีข้อความนี้อยู่ (ไม่ต้องตรงทั้งหมด)' },
  },
  assertCount: { label: 'ตรวจจำนวน element', group: 'assert', locator: 'required', fields: { expected: 'ต้องเจอกี่ตัว' } },
  assertURL: { label: 'ตรวจ URL', group: 'assert', fields: { expected: 'URL ที่ต้องเป็น' } },
};

export const isActionName = (name: unknown): name is ActionName => typeof name === 'string' && Object.hasOwn(ACTIONS, name);

/** step ที่มี locator (ไม่รวม press ที่ locator ไม่บังคับ) */
export type StepWithLocator = Extract<Step, { locator: Locator | null }>;
