import { FINGERPRINT_KEYS, type Fingerprint } from './types.js';

/** ค่าที่อ่านจากหน้าเว็บ (ช่องที่ไม่มีเป็น null) */
export type PageFingerprint = { tag: string } & Record<Exclude<(typeof FINGERPRINT_KEYS)[number], 'tag'>, string | null>;

/**
 * ลายนิ้วมือของ element ใช้ยืนยันว่า locator สำรองยังชี้ไปที่ element เดิม
 * ฟังก์ชันนี้ถูกส่งไปรันในหน้าเว็บ (page.evaluate) ด้วยการแปลงเป็นข้อความ
 * จึงห้ามอ้างอิงตัวแปรหรือ import ใดนอกฟังก์ชัน
 */
export function fingerprintInPage(el: Element): PageFingerprint {
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const tag = el.tagName.toLowerCase();
  return {
    tag,
    type: el.getAttribute('type'),
    id: el.id || null,
    name: el.getAttribute('name'),
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('placeholder'),
    testId: el.getAttribute('data-testid'),
    text: ['input', 'select', 'textarea'].includes(tag) ? null : norm((el as HTMLElement).innerText).slice(0, 100) || null,
  };
}

/** คะแนน 0..1 = สัดส่วนคุณสมบัติที่บันทึกไว้แล้วยังตรงกัน (tag ต้องตรงเสมอ) */
export function fingerprintScore(recorded: Fingerprint | null | undefined, current: Partial<Fingerprint> | null | undefined): number {
  if (!recorded || !current || recorded.tag !== current.tag) return 0;
  const keys = FINGERPRINT_KEYS.filter((k) => k !== 'tag' && recorded[k]);
  if (keys.length === 0) return 0;
  return keys.filter((k) => recorded[k] === current[k]).length / keys.length;
}
