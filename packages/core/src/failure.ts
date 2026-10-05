// สาเหตุที่น่าจะเป็นของเทสที่พัง: จัดหมวดจากข้อความ error ได้ทันที (ไม่ต้องใช้ AI) แล้ว AI ค่อยช่วยอธิบายละเอียดขึ้นถ้าตั้งค่าไว้
import { z } from 'zod';

export const FAILURE_CATEGORIES = {
  locator: 'หา element ไม่เจอ',
  assertion: 'ผลไม่ตรงที่ตรวจ',
  navigation: 'ไปไม่ถึงหน้าที่คาด',
  network: 'เปิดเว็บไม่ขึ้น',
  blocked: 'ถูกกันการเข้าถึง',
  data: 'ข้อมูลทดสอบไม่พร้อม',
  script: 'โค้ดในเทสผิดพลาด',
  app: 'น่าจะเป็นบั๊กของระบบ',
  unknown: 'ยังระบุไม่ได้',
} as const;
export type FailureCategory = keyof typeof FAILURE_CATEGORIES;

export const failureAnalysisSchema = z.object({
  category: z.enum(Object.keys(FAILURE_CATEGORIES) as [FailureCategory, ...FailureCategory[]]),
  /** อธิบายสั้นๆ ว่าเกิดอะไร (ภาษาไทย) */
  summary: z.string().max(400),
  /** ควรทำอะไรต่อ (ภาษาไทย) */
  suggestion: z.string().max(400),
  /** rules = จัดหมวดจากข้อความ error, ai = AI ดูภาพหน้าจอ/หน้าเว็บประกอบ */
  source: z.enum(['rules', 'ai']),
  model: z.string().max(80).optional(),
});
export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

const RULES: { test: RegExp; category: FailureCategory; summary: string; suggestion: string }[] = [
  {
    test: /ยังไม่ได้ตั้งค่าตัวแปรลับ/,
    category: 'data',
    summary: 'เทสใช้ตัวแปรลับที่ยังไม่ได้ตั้งค่าในโปรเจกต์นี้',
    suggestion: 'ไปที่หน้าตั้งค่าแล้วเพิ่มตัวแปรลับตามชื่อที่ระบุ',
  },
  {
    test: /ไม่อนุญาต|ALLOWED_HOSTS|เปิดได้เฉพาะ|ถูกบล็อก/,
    category: 'blocked',
    summary: 'runner ไม่ยอมเปิด URL นี้เพราะเป็นที่อยู่ภายในหรือไม่อยู่ในรายการที่อนุญาต',
    suggestion: 'ตรวจ URL/environment ที่ใช้ ถ้าเป็นเว็บภายในองค์กรให้เพิ่มโดเมนใน ALLOWED_HOSTS ของ runner',
  },
  {
    test: /net::ERR_|หาโดเมน|ECONNREFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/,
    category: 'network',
    summary: 'เปิดหน้าเว็บไม่ขึ้น เว็บอาจล่ม ยังไม่ได้ deploy หรือ URL/environment ผิด',
    suggestion: 'ลองเปิด URL นั้นเองในเบราว์เซอร์ และตรวจ base URL ของ environment',
  },
  {
    test: /หา element ไม่เจอ|element ยังไม่พร้อม|strict mode violation|resolved to \d+ elements/,
    category: 'locator',
    summary: 'หา element ที่ step นี้ใช้ไม่เจอภายในเวลาที่กำหนด อาจถูกเปลี่ยนชื่อ ย้ายที่ หรือหน้ายังโหลดไม่เสร็จ',
    suggestion: 'เปิด Trace ดูหน้าตอนพัง ถ้า element เปลี่ยนให้เลือกใหม่ใน Workspace ถ้า element หายไปจริงอาจเป็นบั๊ก',
  },
  {
    test: /URL ไม่ตรง/,
    category: 'navigation',
    summary: 'หลังทำ step ก่อนหน้า หน้าเว็บไม่ได้ไปที่ URL ที่คาดไว้',
    suggestion: 'ดูใน Trace ว่าค้างที่หน้าไหน เช่น ล็อกอินไม่สำเร็จ หรือมีหน้าคั่นขึ้นมา',
  },
  {
    test: /ข้อความไม่ตรง|จำนวนไม่ตรง/,
    category: 'assertion',
    summary: 'หน้าเว็บแสดงผลไม่ตรงกับที่เทสตรวจไว้',
    suggestion: 'ถ้าข้อความ/จำนวนเปลี่ยนโดยตั้งใจให้แก้ค่าที่ตรวจในเทส ถ้าไม่ได้ตั้งใจอาจเป็นบั๊ก',
  },
  {
    test: /^โค้ด|SyntaxError|โค้ดคืนค่า false|ยังไม่ได้เขียนโค้ด/,
    category: 'script',
    summary: 'step รันโค้ด JavaScript ผิดพลาดหรือคืนค่า false',
    suggestion: 'เปิดตัวแก้โค้ดใน Workspace แล้วกด "ลองรันกับหน้าเว็บตอนนี้" เพื่อดูข้อผิดพลาด',
  },
];

export function classifyFailure(error: string): FailureAnalysis {
  const rule = RULES.find((r) => r.test.test(error));
  return rule
    ? { category: rule.category, summary: rule.summary, suggestion: rule.suggestion, source: 'rules' }
    : { category: 'unknown', summary: 'ระบบจัดหมวดจากข้อความ error ไม่ได้', suggestion: 'เปิด Trace ดูหน้าเว็บและ network ตอนพังเพื่อหาสาเหตุ', source: 'rules' };
}
