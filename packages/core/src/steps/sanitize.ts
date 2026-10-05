import { ACTIONS, FINGERPRINT_KEYS, LOCATOR_TYPES, MAX_FALLBACKS, MAX_SCRIPT, SECRET_NAME, isActionName, stepSchema, type ActionName, type Fingerprint, type Locator, type LocatorType, type Step } from './types.js';

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeLocator(input: unknown): Locator {
  const loc = isRecord(input) ? input : {};
  const type = loc.type;
  if (typeof type !== 'string' || !Object.hasOwn(LOCATOR_TYPES, type)) throw new Error('ไม่รู้จักประเภท locator');
  if (type === 'role') {
    const role = String(loc.role ?? '').trim();
    if (!role) throw new Error('กรุณาระบุ role');
    const name = loc.name == null ? '' : String(loc.name).trim();
    return name ? { type: 'role', role, name } : { type: 'role', role };
  }
  const value = String(loc.value ?? '').trim();
  if (!value) throw new Error('กรุณาระบุค่า locator');
  return { type: type as Exclude<LocatorType, 'role'>, value };
}

/**
 * ตรวจและทำความสะอาด step ที่มาจากผู้ใช้ (Step Editor) หรือ AI
 * โยน Error พร้อมข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้เลย ส่วนผลลัพธ์ผ่าน stepSchema อีกชั้นเสมอ
 */
export function sanitizeStep(input: unknown): Step {
  const raw = isRecord(input) ? input : {};
  const action = raw.action;
  if (!isActionName(action)) throw new Error('ไม่รู้จักประเภท step');
  const spec = ACTIONS[action];
  const step: Raw = { action };

  if (spec.locator) {
    if (raw.locator) step.locator = sanitizeLocator(raw.locator);
    else if (spec.locator === 'required') step.locator = null; // ยังไม่ได้เลือก element (เช่น step ที่เพิ่งเพิ่มเอง)

    // ข้อมูลสำหรับ self-healing: locator สำรองและลายนิ้วมือของ element ตอนบันทึก
    if (step.locator && Array.isArray(raw.fallbacks)) {
      const fallbacks: Locator[] = [];
      for (const f of raw.fallbacks.slice(0, MAX_FALLBACKS)) {
        try {
          fallbacks.push(sanitizeLocator(f));
        } catch {
          // ตัวสำรองที่ไม่ถูกต้องตัดทิ้งไป ไม่ต้องให้ผู้ใช้แก้
        }
      }
      if (fallbacks.length) step.fallbacks = fallbacks;
    }
    if (step.locator && isRecord(raw.fingerprint)) {
      const fp: Record<string, string> = {};
      for (const k of FINGERPRINT_KEYS) {
        const v = raw.fingerprint[k];
        if (v) fp[k] = String(v).slice(0, 100);
      }
      if (fp.tag) step.fingerprint = fp as unknown as Fingerprint;
    }
  }

  for (const field of Object.keys(spec.fields ?? {})) step[field] = String(raw[field] ?? '');

  if (action === 'fillForm') {
    const fields = Array.isArray(raw.fields) ? raw.fields.slice(0, 30) : [];
    step.fields = fields.map((entry) => {
      const field = isRecord(entry) ? entry : {};
      let locator: Locator | null = null;
      if (field.locator) locator = sanitizeLocator(field.locator);
      else if (String(field.label ?? '').trim()) locator = { type: 'label', value: String(field.label).trim() };
      return { locator, value: String(field.value ?? '') };
    });
  }

  if (action === 'fill' && raw.secret) {
    const name = String(raw.secret).trim().toUpperCase();
    if (!SECRET_NAME.test(name)) throw new Error('ชื่อตัวแปรลับใช้ได้เฉพาะ A-Z, 0-9 และ _');
    step.secret = name;
    delete step.value;
  }
  if (action === 'selectOption' && raw.label) step.label = String(raw.label);
  if (action === 'assertCount' && !/^\d+$/.test(String(step.expected).trim())) throw new Error('จำนวนต้องเป็นตัวเลข');
  if (action === 'script') {
    const script = typeof raw.script === 'string' ? raw.script : '';
    if (script.length > MAX_SCRIPT) throw new Error(`โค้ดยาวเกิน ${MAX_SCRIPT.toLocaleString()} ตัวอักษร`);
    step.script = script;
  }
  if (action === 'useTest') {
    const id = Number(raw.testId);
    step.testId = Number.isInteger(id) && id > 0 ? id : null;
  }
  return stepSchema.parse(step);
}

/** ค่าเริ่มต้นของ step ที่ผู้ใช้กด "+ เพิ่ม Step" */
export function blankStep(action: ActionName): Step {
  return sanitizeStep({ action, ...(action === 'press' && { key: 'Enter' }), ...(action === 'assertCount' && { expected: '1' }), ...(action === 'fillForm' && { fields: [{ locator: null, value: '' }] }) });
}

export function isComplete(step: Step): boolean {
  if (step.action === 'useTest') return !!step.testId;
  if (step.action === 'script') return !!step.script.trim();
  if (step.action === 'fillForm') return step.fields.length > 0 && step.fields.every((field) => !!field.locator || !!field.label?.trim());
  if (ACTIONS[step.action].locator !== 'required') return true;
  return 'locator' in step && !!step.locator;
}
