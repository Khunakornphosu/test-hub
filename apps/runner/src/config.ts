import { z } from 'zod';

// ค่าตั้งทั้งหมดของ runner มาจาก environment (ตรวจรูปแบบตอนเริ่ม ถ้าผิดจะไม่ยอมเริ่มและบอกเหตุผล)
const bool = z.enum(['true', 'false', '1', '0', '']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4800),
  /** ค่าเริ่มต้นฟังเฉพาะเครื่องนี้ ถ้าเปิดให้เครือข่ายอื่นเข้า (0.0.0.0) ต้องตั้ง RUNNER_TOKEN_SECRET */
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'ต้องตั้ง DATABASE_URL'),
  /** key เข้ารหัสตัวแปรลับ: ต้องเป็นค่าเดียวกับที่ใช้ตอนบันทึก มิฉะนั้นถอดรหัสไม่ได้ */
  SECRET_KEY: z.string().min(8, 'ต้องตั้ง SECRET_KEY อย่างน้อย 8 ตัวอักษร'),
  /** secret ร่วมกับหน้าเว็บสำหรับตรวจ token ของ WebSocket (ว่าง = ไม่ตรวจ ใช้ได้เฉพาะตอนฟังเครื่องตัวเอง) */
  RUNNER_TOKEN_SECRET: z.string().optional().default(''),
  /** เว็บที่อนุญาตให้เชื่อม WebSocket (คั่นด้วย ,) เช่น https://test-studio.vercel.app ว่าง = เฉพาะ origin เดียวกับ Host */
  ALLOWED_ORIGINS: z.string().optional().default(''),
  MAX_SESSIONS: z.coerce.number().int().positive().default(4),
  RUN_MIGRATIONS: bool.optional().default(false),
});

export interface RunnerConfig {
  port: number;
  host: string;
  databaseUrl: string;
  secretKey: string;
  tokenSecret: string;
  allowedOrigins: string[];
  maxSessions: number;
  runMigrations: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function loadConfig(env: Record<string, string | undefined> = process.env): RunnerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`).join('\n');
    throw new Error(`ค่าตั้งของ runner ไม่ถูกต้อง:\n${problems}`);
  }
  const e = parsed.data;
  if (!LOOPBACK.has(e.HOST) && !e.RUNNER_TOKEN_SECRET) {
    throw new Error(`HOST=${e.HOST} เปิดให้เครื่องอื่นเข้าถึงได้ กรุณาตั้ง RUNNER_TOKEN_SECRET ก่อน`);
  }
  return {
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    secretKey: e.SECRET_KEY,
    tokenSecret: e.RUNNER_TOKEN_SECRET,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    maxSessions: e.MAX_SESSIONS,
    runMigrations: e.RUN_MIGRATIONS,
  };
}
