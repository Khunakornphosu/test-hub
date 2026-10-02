// รูปแบบผลการรันเทส (เก็บเป็น JSON ในฐานข้อมูล และส่งให้หน้าเว็บ)
import { z } from 'zod';
import { locatorSchema } from './steps/types.js';

/** locator ที่ระบบใช้แทนตัวหลักตอนรัน (self-healing) รอผู้ใช้ยืนยัน */
export const healedSchema = z.object({
  /** เทสที่เป็นเจ้าของ step นี้ (อาจเป็นเทสอื่นถ้า step อยู่ใน block) */
  testId: z.number().int(),
  stepId: z.number().int(),
  locator: locatorSchema,
  label: z.string(),
});
export type Healed = z.infer<typeof healedSchema>;

export const runStepResultSchema = z.object({
  stepId: z.number().int(),
  label: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
  ms: z.number().optional(),
  error: z.string().optional(),
  healed: z.array(healedSchema).optional(),
});
export type RunStepResult = z.infer<typeof runStepResultSchema>;

export const runResultsSchema = z.array(runStepResultSchema);
