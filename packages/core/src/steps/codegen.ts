import { isComplete } from './sanitize.js';
import { ACTIONS, type Locator, type Step } from './types.js';


/** ใส่ใน string literal ของ TypeScript แบบ single quote */
const q = (s: unknown): string => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

export function locatorToCode(loc: Locator): string {
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

export interface CodegenContext {
  testName?: (id: number) => string | undefined;
}

export function stepToCode(step: Step, ctx: CodegenContext = {}): string {
  if (!isComplete(step)) {
    return step.action === 'useTest'
      ? '// TODO: ใช้เทสอื่นซ้ำ — ยังไม่ได้เลือกเทส'
      : step.action === 'fillForm'
        ? '// TODO: กรอกฟอร์มหลายช่อง — กรุณาเลือก element ของทุกช่อง'
      : step.action === 'script'
        ? '// TODO: รันโค้ด JavaScript — ยังไม่ได้เขียนโค้ด'
      : `// TODO: ${ACTIONS[step.action].label} — ยังไม่ได้เลือก element`;
  }
  const L = 'locator' in step && step.locator ? locatorToCode(step.locator) : null;
  switch (step.action) {
    case 'script':
      return [
        'expect(await page.evaluate(async () => {',
        ...step.script.replace(/\s+$/, '').split('\n').map((line) => (line ? `  ${line}` : '')),
        '})).not.toBe(false);',
      ].join('\n');
    case 'goto':
      return `await page.goto(${q(step.value)});`;
    case 'click':
      return `await ${L}.click();`;
    case 'check':
      return `await ${L}.check();`;
    case 'uncheck':
      return `await ${L}.uncheck();`;
    case 'fill':
      return `await ${L}.fill(${step.secret ? `process.env.${step.secret} ?? ''` : q(step.value ?? '')});`;
    case 'fillForm':
      return step.fields.map((field) => {
        const locator = field.locator ?? (field.label?.trim() ? { type: 'label' as const, value: field.label.trim() } : null);
        return locator ? `await ${locatorToCode(locator)}.fill(${q(field.value)});` : '// TODO: เลือก element ของช่องฟอร์ม';
      }).join('\n');
    case 'press':
      return L ? `await ${L}.press(${q(step.key)});` : `await page.keyboard.press(${q(step.key)});`;
    case 'selectOption':
      return `await ${L}.selectOption(${q(step.value)});`;
    case 'useTest':
      return `await test.step(${q(ctx.testName?.(step.testId!) ?? `เทส #${step.testId}`)}, async () => { … });`;
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

export interface ExportableTest {
  id: number;
  name: string;
  steps: Step[];
}

/**
 * โค้ด Playwright ของเทสหนึ่ง โดยขยาย block (useTest) เป็น test.step ซ้อนกัน
 * resolveTest = หาเทสที่ถูกใช้ซ้ำ, rootId = id ของเทสที่ export เอง เพื่อจับ block ที่วนกลับมาเรียกเทสนี้
 */
export function exportTest(
  name: string,
  steps: Step[],
  resolveTest: (id: number) => ExportableTest | null | undefined = () => null,
  rootId: number | null = null
): string {
  const secretNames = new Set<string>();
  const lines = (list: Step[], indent: string, stack: number[]): string[] =>
    list.flatMap((s) => {
      if (s.action === 'fill' && s.secret) secretNames.add(s.secret);
      if (s.action !== 'useTest' || !s.testId) return stepToCode(s).split('\n').map((line) => `${indent}${line}`);
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

/** JSON สำหรับเก็บ/ส่งต่อ: step เก็บแค่ชื่อตัวแปรลับ ไม่มีค่าจริง */
export function exportJson(name: string, steps: Step[]): string {
  return JSON.stringify({ name, steps: steps.map(({ id: _id, ...rest }) => rest) }, null, 2);
}
