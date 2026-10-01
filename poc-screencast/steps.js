// แหล่งเดียวสำหรับแปลง step JSON -> (1) คำสั่ง Playwright ตอนรัน และ (2) โค้ดตอน Export
// ใช้ตารางเดียวกันทั้งสองทาง เพื่อให้ผลที่รันในระบบตรงกับโค้ดที่ส่งออกไป

const STEP_TIMEOUT = 5000;
// ถ้า locator หลักหาไม่เจอเกินเวลานี้ จึงเริ่มลองตัวสำรอง (กันกรณีหน้ายังโหลดไม่เสร็จ)
const HEAL_GRACE = 1500;
// สัดส่วนลายนิ้วมือที่ต้องตรงกัน จึงจะยอมรับว่าเป็น element เดิม
const HEAL_MIN_SCORE = 0.5;
const MAX_FALLBACKS = 4;

// ประเภท step ที่รองรับ: locator = 'required' | 'optional' | undefined, fields = ช่องที่ผู้ใช้แก้ได้
// ส่งให้หน้าเว็บใช้สร้างฟอร์ม Step Editor ด้วย
export const ACTIONS = {
  goto: { label: 'เปิดหน้าเว็บ', group: 'action', fields: { value: 'URL' } },
  click: { label: 'คลิก', group: 'action', locator: 'required' },
  fill: { label: 'พิมพ์ข้อความ', group: 'action', locator: 'required', fields: { value: 'ข้อความที่จะพิมพ์' } },
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

export const LOCATOR_TYPES = {
  role: 'Role',
  label: 'Label',
  placeholder: 'Placeholder',
  testid: 'Test ID',
  text: 'ข้อความ',
  css: 'CSS',
};

const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/;
const FINGERPRINT_KEYS = ['tag', 'type', 'id', 'name', 'role', 'ariaLabel', 'placeholder', 'testId', 'text'];

function sanitizeLocator(loc) {
  if (!LOCATOR_TYPES[loc?.type]) throw new Error('ไม่รู้จักประเภท locator');
  if (loc.type === 'role') {
    const role = String(loc.role ?? '').trim();
    if (!role) throw new Error('กรุณาระบุ role');
    const name = loc.name == null ? '' : String(loc.name).trim();
    return name ? { type: 'role', role, name } : { type: 'role', role };
  }
  const value = String(loc.value ?? '').trim();
  if (!value) throw new Error('กรุณาระบุค่า locator');
  return { type: loc.type, value };
}

// ตรวจและทำความสะอาด step ที่มาจาก Step Editor (ข้อมูลจากผู้ใช้)
export function sanitizeStep(raw) {
  const spec = ACTIONS[raw?.action];
  if (!spec) throw new Error('ไม่รู้จักประเภท step');
  const step = { action: raw.action };

  if (spec.locator) {
    if (raw.locator) step.locator = sanitizeLocator(raw.locator);
    else if (spec.locator === 'required') step.locator = null; // ยังไม่ได้เลือก element (เช่น step ที่เพิ่งเพิ่มเอง)

    // ข้อมูลสำหรับ self-healing: locator สำรองและลายนิ้วมือของ element ตอนบันทึก
    if (step.locator && Array.isArray(raw.fallbacks)) {
      const fallbacks = [];
      for (const f of raw.fallbacks.slice(0, MAX_FALLBACKS)) {
        try {
          fallbacks.push(sanitizeLocator(f));
        } catch {
          // ตัวสำรองที่ไม่ถูกต้องตัดทิ้งไป ไม่ต้องให้ผู้ใช้แก้
        }
      }
      if (fallbacks.length) step.fallbacks = fallbacks;
    }
    if (step.locator && raw.fingerprint && typeof raw.fingerprint === 'object') {
      const fp = {};
      for (const k of FINGERPRINT_KEYS) if (raw.fingerprint[k]) fp[k] = String(raw.fingerprint[k]).slice(0, 100);
      if (fp.tag) step.fingerprint = fp;
    }
  }

  for (const field of Object.keys(spec.fields ?? {})) step[field] = String(raw[field] ?? '');

  if (raw.action === 'fill' && raw.secret) {
    const name = String(raw.secret).trim().toUpperCase();
    if (!SECRET_NAME.test(name)) throw new Error('ชื่อตัวแปรลับใช้ได้เฉพาะ A-Z, 0-9 และ _');
    step.secret = name;
    delete step.value;
  }
  if (raw.action === 'selectOption' && raw.label) step.label = String(raw.label);
  if (raw.action === 'assertCount' && !/^\d+$/.test(step.expected.trim())) throw new Error('จำนวนต้องเป็นตัวเลข');
  if (raw.action === 'useTest') {
    const id = Number(raw.testId);
    step.testId = Number.isInteger(id) && id > 0 ? id : null;
  }
  return step;
}

// ค่าเริ่มต้นของ step ที่ผู้ใช้กด "+ เพิ่ม Step"
export function blankStep(action) {
  return sanitizeStep({ action, ...(action === 'press' && { key: 'Enter' }), ...(action === 'assertCount' && { expected: '1' }) });
}

export function isComplete(step) {
  if (step.action === 'useTest') return !!step.testId;
  return ACTIONS[step.action]?.locator !== 'required' || !!step.locator;
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

export function toLocator(page, loc) {
  switch (loc.type) {
    case 'role':
      return loc.name != null
        ? page.getByRole(loc.role, { name: loc.name, exact: true })
        : page.getByRole(loc.role);
    case 'label':
      return page.getByLabel(loc.value, { exact: true });
    case 'placeholder':
      return page.getByPlaceholder(loc.value, { exact: true });
    case 'testid':
      return page.getByTestId(loc.value);
    case 'text':
      return page.getByText(loc.value, { exact: true });
    case 'css':
      return page.locator(loc.value);
    default:
      throw new Error(`ไม่รู้จัก locator type: ${loc.type}`);
  }
}

export function locatorToCode(loc) {
  switch (loc.type) {
    case 'role':
      return loc.name != null
        ? `page.getByRole(${q(loc.role)}, { name: ${q(loc.name)}, exact: true })`
        : `page.getByRole(${q(loc.role)})`;
    case 'label':
      return `page.getByLabel(${q(loc.value)}, { exact: true })`;
    case 'placeholder':
      return `page.getByPlaceholder(${q(loc.value)}, { exact: true })`;
    case 'testid':
      return `page.getByTestId(${q(loc.value)})`;
    case 'text':
      return `page.getByText(${q(loc.value)}, { exact: true })`;
    case 'css':
      return `page.locator(${q(loc.value)})`;
  }
}

// ctx.testName(id) ใช้แสดงชื่อเทสของ step useTest
export function stepToCode(step, ctx = {}) {
  if (!isComplete(step)) {
    return step.action === 'useTest'
      ? '// TODO: ใช้เทสอื่นซ้ำ — ยังไม่ได้เลือกเทส'
      : `// TODO: ${ACTIONS[step.action].label} — ยังไม่ได้เลือก element`;
  }
  const L = step.locator && locatorToCode(step.locator);
  switch (step.action) {
    case 'goto':
      return `await page.goto(${q(step.value)});`;
    case 'click':
      return `await ${L}.click();`;
    case 'check':
      return `await ${L}.check();`;
    case 'uncheck':
      return `await ${L}.uncheck();`;
    case 'fill':
      return `await ${L}.fill(${step.secret ? `process.env.${step.secret} ?? ''` : q(step.value)});`;
    case 'press':
      return L ? `await ${L}.press(${q(step.key)});` : `await page.keyboard.press(${q(step.key)});`;
    case 'selectOption':
      return `await ${L}.selectOption(${q(step.value)});`;
    case 'useTest':
      return `await test.step(${q(ctx.testName?.(step.testId) ?? `เทส #${step.testId}`)}, async () => { … });`;
    case 'assertVisible':
      return `await expect(${L}).toBeVisible();`;
    case 'assertText':
      return `await expect(${L}).toContainText(${q(step.expected)});`;
    case 'assertCount':
      return `await expect(${L}).toHaveCount(${Number(step.expected)});`;
    case 'assertURL':
      return `await expect(page).toHaveURL(${q(step.expected)});`;
  }
}

// resolveTest(id) -> { id, name, steps } ใช้ขยาย block (useTest) เป็น test.step ซ้อนกัน
// rootId = id ของเทสที่ export เอง เพื่อจับ block ที่วนกลับมาเรียกเทสนี้
export function exportTest(name, steps, resolveTest = () => null, rootId = null) {
  const secretNames = new Set();
  const lines = (list, indent, stack) =>
    list.flatMap((s) => {
      if (s.secret) secretNames.add(s.secret);
      if (s.action !== 'useTest' || !s.testId) return [`${indent}${stepToCode(s)}`];
      const block = resolveTest(s.testId);
      if (!block) return [`${indent}// ใช้ซ้ำ: ไม่พบเทส #${s.testId} (อาจถูกลบไปแล้ว)`];
      if (stack.includes(block.id)) return [`${indent}// ใช้ซ้ำ: "${block.name}" วนกลับมาเรียกตัวเอง จึงข้ามไป`];
      return [
        `${indent}await test.step(${q(block.name)}, async () => {`,
        ...lines(block.steps, `${indent}  `, [...stack, block.id]),
        `${indent}});`,
      ];
    });
  const body = lines(steps, '  ', rootId ? [rootId] : []).join('\n');
  const secretNote = secretNames.size
    ? `// ต้องตั้งค่า environment variable ก่อนรัน: ${[...secretNames].join(', ')}\n`
    : '';
  return `import { test, expect } from '@playwright/test';

${secretNote}test(${q(name)}, async ({ page }) => {
${body}
});
`;
}

// JSON สำหรับเก็บ/ส่งต่อ: step เก็บแค่ชื่อตัวแปรลับ ไม่มีค่าจริง
export function exportJson(name, steps) {
  return JSON.stringify({ name, steps: steps.map(({ id, ...rest }) => rest) }, null, 2);
}

const ROLE_NAMES = {
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

// element เป้าหมายในรูปที่คนอ่านเข้าใจ: { text, code } โดย code = true ให้แสดงเป็นตัวอักษร monospace
export function describeLocator(loc) {
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

// คำอธิบาย step แยกส่วน: verb (ทำอะไร), target (กับ element ไหน), value (ค่า)
// ctx.testName(id), ctx.testStepCount(id) ใช้กับ step useTest
export function describeParts(step, ctx = {}) {
  const spec = ACTIONS[step.action];
  const target = describeLocator(step.locator);
  const parts = {
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
      parts.value = step.secret ? `•••••• (${step.secret})` : `"${step.value}"`;
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
      const name = step.testId && ctx.testName?.(step.testId);
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

// คำอธิบายเป็นประโยคเดียว ใช้ในประวัติการรัน
export function describeStep(step, ctx) {
  const p = describeParts(step, ctx);
  const target = p.target ? p.target.text : p.missingTarget ? `(${p.missingTarget})` : '';
  return [p.verb, target, p.value].filter(Boolean).join(' ');
}

// ---------- Self-healing ----------

// ลายนิ้วมือของ element (รันในหน้าเว็บ) ใช้ยืนยันว่า locator สำรองยังชี้ไปที่ element เดิม
export function fingerprintInPage(el) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
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
    text: ['input', 'select', 'textarea'].includes(tag) ? null : norm(el.innerText).slice(0, 100) || null,
  };
}

// คะแนน 0..1 = สัดส่วนคุณสมบัติที่บันทึกไว้แล้วยังตรงกัน (tag ต้องตรงเสมอ)
export function fingerprintScore(recorded, current) {
  if (!recorded || !current || recorded.tag !== current.tag) return 0;
  const keys = FINGERPRINT_KEYS.filter((k) => k !== 'tag' && recorded[k]);
  if (keys.length === 0) return 0;
  return keys.filter((k) => recorded[k] === current[k]).length / keys.length;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// หา element ของ step: ใช้ locator หลักก่อน ถ้าหาไม่เจอให้ลองตัวสำรองที่ลายนิ้วมือยังตรง
// คืนค่า { L, healed } โดย healed คือ locator สำรองที่ใช้แทน (ไม่มี = ใช้ตัวหลักได้ปกติ)
async function resolveTarget(page, step) {
  const primary = toLocator(page, step.locator);
  // assertCount นับจำนวนโดยตรง การ "ซ่อม" จะทำให้ความหมายเปลี่ยน
  if (!step.fallbacks?.length || !step.fingerprint || step.action === 'assertCount') return { L: primary };
  const start = Date.now();
  for (;;) {
    if ((await primary.count().catch(() => 0)) === 1) return { L: primary };
    if (Date.now() - start > HEAL_GRACE) {
      for (const fb of step.fallbacks) {
        const L = toLocator(page, fb);
        if ((await L.count().catch(() => 0)) !== 1) continue;
        const fp = await L.evaluate(fingerprintInPage).catch(() => null);
        if (fingerprintScore(step.fingerprint, fp) >= HEAL_MIN_SCORE) return { L, healed: fb };
      }
    }
    // หมดเวลาแล้วยังไม่เจอ ให้คำสั่งจริงทำงานกับตัวหลักต่อ เพื่อได้ error ตามปกติ
    if (Date.now() - start > STEP_TIMEOUT) return { L: primary };
    await sleep(100);
  }
}

const normalize = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function poll(check, message) {
  const deadline = Date.now() + STEP_TIMEOUT;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(message());
    await sleep(100);
  }
}

// รัน step เดียว คืนค่า { healed } ถ้าต้องใช้ locator สำรอง
// step useTest ต้องให้ผู้เรียกขยายเอง เพราะต้องโหลดเทสอื่นจากฐานข้อมูล
// checkUrl(url): ตรวจ URL ก่อน goto (โยน error พร้อมเหตุผลถ้าไม่อนุญาต)
export async function runStep(page, step, { secrets = {}, checkUrl } = {}) {
  if (!isComplete(step)) {
    throw new Error(step.action === 'useTest' ? 'step นี้ยังไม่ได้เลือกเทส' : 'step นี้ยังไม่ได้เลือก element');
  }
  const { L, healed } = step.locator ? await resolveTarget(page, step) : {};
  const opts = { timeout: STEP_TIMEOUT };
  switch (step.action) {
    case 'goto':
      if (checkUrl) await checkUrl(step.value);
      await page.goto(step.value, { waitUntil: 'domcontentloaded' });
      break;
    case 'click':
      await L.click(opts);
      break;
    case 'check':
      await L.check(opts);
      break;
    case 'uncheck':
      await L.uncheck(opts);
      break;
    case 'fill': {
      if (step.secret && secrets[step.secret] == null) throw new Error(`ยังไม่ได้ตั้งค่าตัวแปรลับ ${step.secret}`);
      await L.fill(step.secret ? secrets[step.secret] : step.value, opts);
      break;
    }
    case 'press':
      await (L ? L.press(step.key, opts) : page.keyboard.press(step.key));
      break;
    case 'selectOption':
      await L.selectOption(step.value, opts);
      break;
    case 'assertVisible':
      await L.waitFor({ state: 'visible', ...opts });
      break;
    case 'assertText': {
      let actual = '';
      await L.waitFor({ state: 'visible', ...opts });
      await poll(
        async () => {
          actual = normalize(await L.innerText({ timeout: 500 }));
          return actual.includes(normalize(step.expected));
        },
        () => `ข้อความไม่ตรง: คาดว่ามี "${step.expected}" แต่เจอ "${actual}"`
      );
      break;
    }
    case 'assertCount': {
      let actual = 0;
      await poll(
        async () => (actual = await L.count()) === Number(step.expected),
        () => `จำนวนไม่ตรง: คาดว่า ${step.expected} แต่เจอ ${actual}`
      );
      break;
    }
    case 'assertURL':
      await poll(
        async () => page.url() === step.expected,
        () => `URL ไม่ตรง: คาดว่า ${step.expected} แต่เป็น ${page.url()}`
      );
      break;
    default:
      throw new Error(`ไม่รู้จัก action: ${step.action}`);
  }
  return healed ? { healed } : {};
}
