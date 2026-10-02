// ค่าตั้งฝั่ง server ของหน้าเว็บ ตรวจรูปแบบตอนใช้ครั้งแรก ถ้าผิดจะบอกเหตุผลเป็นภาษาไทย
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'ต้องตั้ง DATABASE_URL'),
  /** key เข้ารหัสตัวแปรลับ ต้องเป็นค่าเดียวกับที่ runner ใช้ */
  SECRET_KEY: z.string().min(8, 'ต้องตั้ง SECRET_KEY อย่างน้อย 8 ตัวอักษร'),
  /** secret ร่วมกับ runner สำหรับออก token ของ WebSocket (ว่าง = runner ต้องรับเฉพาะเครื่องตัวเอง) */
  RUNNER_TOKEN_SECRET: z.string().optional().default(''),
  /** ที่อยู่ WebSocket ของ runner ที่เบราว์เซอร์ของผู้ใช้เชื่อมต่อ เช่น ws://localhost:4800/ws */
  RUNNER_WS_URL: z.string().url().default('ws://127.0.0.1:4800/ws'),
});

export type WebEnv = z.infer<typeof schema>;
let cached: WebEnv | null = null;

export function getEnv(): WebEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`ค่าตั้งของหน้าเว็บไม่ถูกต้อง:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
