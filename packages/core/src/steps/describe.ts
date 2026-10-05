import { ACTIONS, type Locator, type Step } from './types.js';

export interface DescribeContext {
  /** ชื่อเทสของ step useTest */
  testName?: (id: number) => string | undefined;
  testStepCount?: (id: number) => number | undefined;
}

const ROLE_NAMES: Record<string, string> = {
  button: 'ปุ่ม',
  link: 'ลิงก์',
  textbox: 'ช่อง',
  searchbox: 'ช่องค้นหา',
  checkbox: 'checkbox',
  radio: 'ตัวเลือก',
  combobox: 'dropdown',
  listbox: 'รายการ',
  heading: 'หัวข้อ',
  img: 'รูป',
  tab: 'แท็บ',
  menuitem: 'เมนู',
  option: 'ตัวเลือก',
  slider: 'แถบเลื่อน',
  spinbutton: 'ช่องตัวเลข',
};

export interface TargetDescription {
  text: string;
  /** แสดงเป็นตัวอักษร monospace */
  code?: boolean;
  /** เป็นชื่อเทสที่ใช้ซ้ำ (block) */
  block?: boolean;
}

/** element เป้าหมายในรูปที่คนอ่านเข้าใจ */
export function describeLocator(loc: Locator | null | undefined): TargetDescription | null {
  if (!loc) return null;
  switch (loc.type) {
    case 'role': {
      const kind = ROLE_NAMES[loc.role] ?? loc.role;
      return { text: loc.name != null ? `${kind} "${loc.name}"` : kind };
    }
    case 'label':
    case 'placeholder':
      return { text: `ช่อง "${loc.value}"` };
    case 'testid':
      return { text: `test-id: ${loc.value}`, code: true };
    case 'text':
      return { text: `"${loc.value}"` };
    case 'css':
      return { text: loc.value, code: true };
  }
}

export interface StepParts {
  group: 'action' | 'assert';
  verb: string;
  target: TargetDescription | null;
  value: string | null;
  /** ข้อความเตือนเมื่อยังไม่ได้เลือกสิ่งที่จำเป็น */
  missingTarget: string | null;
}

/** คำอธิบาย step แยกส่วน: verb (ทำอะไร), target (กับ element ไหน), value (ค่า) */
export function describeParts(step: Step, ctx: DescribeContext = {}): StepParts {
  const spec = ACTIONS[step.action];
  const target = describeLocator('locator' in step ? step.locator : null);
  const parts: StepParts = {
    group: spec.group,
    verb: spec.label,
    target,
    value: null,
    missingTarget: spec.locator === 'required' && !target ? 'ยังไม่ได้เลือก element' : null,
  };
  switch (step.action) {
    case 'goto':
      parts.verb = 'เปิด';
      parts.value = step.value || '(ยังไม่ได้ใส่ URL)';
      break;
    case 'fill':
      parts.verb = 'พิมพ์';
      parts.value = step.secret ? `•••••• (${step.secret})` : `"${step.value ?? ''}"`;
      break;
    case 'fillForm':
      parts.verb = 'กรอกฟอร์ม';
      parts.value = `${step.fields.length} ช่อง`;
      break;
    case 'press':
      parts.verb = 'กด';
      parts.value = step.key;
      break;
    case 'selectOption':
      parts.verb = 'เลือก';
      parts.value = `"${step.label ?? step.value}"`;
      break;
    case 'check':
      parts.verb = 'ติ๊ก';
      break;
    case 'useTest': {
      parts.verb = 'ใช้ซ้ำ';
      const name = step.testId ? ctx.testName?.(step.testId) : undefined;
      if (!step.testId) parts.missingTarget = 'ยังไม่ได้เลือกเทส';
      else if (!name) parts.missingTarget = 'ไม่พบเทส (อาจถูกลบไปแล้ว)';
      else {
        parts.target = { text: name, block: true };
        const count = ctx.testStepCount?.(step.testId);
        if (count != null) parts.value = `(${count} steps)`;
      }
      break;
    }
    case 'assertVisible':
      parts.verb = 'ตรวจว่าเห็น';
      break;
    case 'assertText':
      parts.verb = 'ตรวจข้อความ';
      parts.value = `มี "${step.expected}"`;
      break;
    case 'assertCount':
      parts.verb = 'ตรวจจำนวน';
      parts.value = `${step.expected} ตัว`;
      break;
    case 'assertURL':
      parts.value = step.expected;
      break;
  }
  return parts;
}

/** คำอธิบายเป็นประโยคเดียว ใช้ในประวัติการรัน */
export function describeStep(step: Step, ctx?: DescribeContext): string {
  const p = describeParts(step, ctx);
  const target = p.target ? p.target.text : p.missingTarget ? `(${p.missingTarget})` : '';
  return [p.verb, target, p.value].filter(Boolean).join(' ');
}
