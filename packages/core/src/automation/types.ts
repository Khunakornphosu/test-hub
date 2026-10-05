// รันอัตโนมัติ: ตั้งเวลา, environment, แจ้งเตือน และรอบการรัน (ใช้ทั้งหน้าเว็บ, API และ runner)
import { z } from 'zod';

export const DEFAULT_TIMEZONE = 'Asia/Bangkok';

export const runTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project') }),
  z.object({ type: z.literal('test'), id: z.number().int().positive() }),
  z.object({ type: z.literal('flow'), id: z.number().int().positive() }),
]);
export type RunTarget = z.infer<typeof runTargetSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็นรูปแบบ HH:MM');
export const INTERVAL_CHOICES = [15, 30, 60, 120, 180, 360, 720] as const;
export const scheduleTimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(15, 'รันถี่ที่สุดได้ทุก 15 นาที').max(24 * 60) }),
  z.object({
    kind: z.literal('daily'),
    time: hhmm,
    /** 0 = อาทิตย์ … 6 = เสาร์ */
    days: z.array(z.number().int().min(0).max(6)).min(1, 'เลือกอย่างน้อย 1 วัน').max(7),
    timezone: z.string().default(DEFAULT_TIMEZONE),
  }),
]);
export type ScheduleTiming = z.infer<typeof scheduleTimingSchema>;

export const CHANNEL_TYPES = ['slack', 'discord', 'webhook', 'line'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_LABELS: Record<ChannelType, string> = { slack: 'Slack', discord: 'Discord', webhook: 'Webhook (JSON)', line: 'LINE (Messaging API)' };

const httpsUrl = z.string().url('URL ไม่ถูกต้อง').refine((u) => u.startsWith('https://'), 'ต้องเป็น URL แบบ https');
export const channelConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('slack'), url: httpsUrl }),
  z.object({ type: z.literal('discord'), url: httpsUrl }),
  z.object({ type: z.literal('webhook'), url: httpsUrl }),
  z.object({
    type: z.literal('line'),
    accessToken: z.string().trim().min(20, 'ต้องใส่ Channel access token'),
    /** user ID / group ID ที่จะส่งถึง (บอทต้องอยู่ในกลุ่มนั้นแล้ว) */
    to: z.string().trim().regex(/^[UCR][0-9a-f]{32}$/, 'ID ผู้รับต้องขึ้นต้นด้วย U, C หรือ R ตามด้วยตัวอักษร 32 ตัว'),
  }),
]);
export type ChannelConfig = z.infer<typeof channelConfigSchema>;

/** problems = แจ้งเมื่อไม่ผ่าน และเมื่อกลับมาผ่านหลังจากไม่ผ่าน, always = ทุกครั้ง */
export type NotifyOn = 'problems' | 'always';
export type BatchTrigger = 'schedule' | 'api' | 'manual';
export type BatchStatus = 'queued' | 'running' | 'done' | 'error';

export const environmentSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อ').max(40),
  baseUrl: z
    .string()
    .trim()
    .url('URL ไม่ถูกต้อง')
    .refine((u) => /^https?:\/\//.test(u), 'ต้องเป็น http หรือ https'),
});

/**
 * เปลี่ยนโดเมนของ URL ให้เป็นของ environment (เก็บ path/query/hash เดิม)
 * ใช้กับ step "เปิดหน้าเว็บ" เท่านั้น การคลิกลิงก์ในหน้าจะตามโดเมนใหม่เอง
 */
export function rebaseUrl(url: string, baseUrl: string): string {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return url;
  }
  const basePath = base.pathname.replace(/\/$/, '');
  return `${base.origin}${basePath}${target.pathname}${target.search}${target.hash}`;
}
