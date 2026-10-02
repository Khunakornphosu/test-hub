// หา element ที่ผู้ใช้กระทำ และเลือก locator ที่ดีที่สุดตามลำดับ:
// role > label > placeholder > test-id > text > CSS id > CSS path
// ทุกตัวเลือกถูกตรวจด้วย Playwright จริงว่าเจอ 1 ตัวและเป็น element เดียวกับที่คลิก
//
// หมายเหตุ: ฟังก์ชันที่ส่งเข้า evaluate() ถูกแปลงเป็นข้อความแล้วรันในหน้าเว็บ จึงห้ามอ้างอิงตัวแปรนอกฟังก์ชัน
import { fingerprintInPage, toLocator, type Fingerprint, type Locator } from '@test-studio/core';
import type { ElementHandle, Page } from 'playwright';

export type Handle = ElementHandle<Element>;

const HIGHLIGHT_ID = '__test_studio_highlight__';
const MATCH_ATTR = 'data-test-studio-match';

// element ที่คลิกได้ซึ่งครอบ element ที่อยู่ใต้เมาส์ (เช่น <span> ในปุ่ม -> <button>)
const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [contenteditable=""], [contenteditable="true"], ' +
  '[role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option]';

export async function elementAt(page: Page, x: number, y: number): Promise<Handle | null> {
  const handle = await page.evaluateHandle(
    ({ x, y, selector }) => {
      const hit = document.elementFromPoint(x, y);
      const el = hit ? hit.closest(selector) || hit : null;
      // คลิกที่ label ของ checkbox/radio = ติ๊กตัวควบคุมนั้น
      const control = el instanceof HTMLLabelElement ? el.control : null;
      return control && ['checkbox', 'radio'].includes((control as HTMLInputElement).type) ? control : el;
    },
    { x, y, selector: INTERACTIVE }
  );
  const el = handle.asElement();
  if (!el) await handle.dispose();
  return el;
}

export async function focusedEditable(page: Page): Promise<Handle | null> {
  const handle = await page.evaluateHandle(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable ? el : null;
  });
  const el = handle.asElement();
  if (!el) await handle.dispose();
  return el;
}

export interface ElementInfo {
  tag: string;
  type: string;
  checked: boolean;
  multiple: boolean;
  editable: boolean;
  value: string;
  text: string;
  options: { value: string; label: string; selected: boolean }[] | null;
}

/** ข้อมูลพื้นฐานของ element ที่ recorder ต้องใช้ตัดสินใจ */
export function inspect(el: Handle): Promise<ElementInfo> {
  return el.evaluate((node) => {
    const el = node as HTMLInputElement & HTMLSelectElement;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    return {
      tag,
      type,
      checked: !!el.checked,
      multiple: !!el.multiple,
      editable:
        tag === 'textarea' ||
        el.isContentEditable ||
        (tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color'].includes(type)),
      value: el.isContentEditable ? el.innerText : el.value,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      options: tag === 'select' ? [...el.options].map((o) => ({ value: o.value, label: o.label, selected: o.selected })) : null,
    };
  });
}

// สร้างตัวเลือก locator ในหน้าเว็บ (ยังไม่ตรวจ) เรียงตามลำดับความสำคัญ
function candidatesInPage(node: Element): Locator[] {
  const el = node as HTMLInputElement & HTMLSelectElement & HTMLElement;
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const out: Locator[] = [];

  const implicitRole = (): string | null => {
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img' && el.getAttribute('alt')) return 'img';
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (['', 'text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
    }
    return null;
  };
  const role = (el.getAttribute('role') || '').split(' ')[0] || implicitRole();

  const labelText = () => {
    const labels = el.labels ? [...el.labels] : [];
    return norm(
      labels
        .map((l) => {
          const c = l.cloneNode(true) as HTMLElement;
          c.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
          return c.textContent;
        })
        .join(' ')
    );
  };

  // ชื่อที่เข้าถึงได้ (accessible name) แบบประมาณ — ถ้าไม่ตรงกับ Playwright การตรวจจะตัดทิ้งเอง
  let name = '';
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) name = norm(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
  if (!name) name = norm(el.getAttribute('aria-label'));
  if (!name && ['input', 'select', 'textarea'].includes(tag)) name = labelText();
  if (!name && tag === 'input' && ['button', 'submit', 'reset'].includes(type)) name = norm(el.value);
  if (!name && tag === 'img') name = norm(el.getAttribute('alt'));
  if (!name && !['input', 'select', 'textarea'].includes(tag)) name = norm(el.innerText);
  if (!name) name = norm(el.getAttribute('title') || el.getAttribute('placeholder'));

  if (role && name && name.length <= 80) out.push({ type: 'role', role, name });
  if (role && !name) out.push({ type: 'role', role });

  const label = labelText();
  if (label) out.push({ type: 'label', value: label });

  const placeholder = norm(el.getAttribute('placeholder'));
  if (placeholder) out.push({ type: 'placeholder', value: placeholder });

  const testId = el.getAttribute('data-testid');
  if (testId) out.push({ type: 'testid', value: testId });

  const text = norm(el.innerText);
  if (text && text.length <= 50 && !['input', 'select', 'textarea'].includes(tag)) out.push({ type: 'text', value: text });

  // id ที่ดูเหมือนสร้างอัตโนมัติ (เลขยาว/hash) มักเปลี่ยนทุกครั้ง จึงไม่ใช้
  const stableId = (id: string | null | undefined) => !!id && !/\d{3,}|[a-f0-9]{8,}|^:r/i.test(id);
  if (stableId(el.id)) out.push({ type: 'css', value: `#${CSS.escape(el.id)}` });

  // tag + class ที่ดูตั้งใจตั้งชื่อ (ข้าม class ที่สร้างอัตโนมัติ เช่น css-1x2y3z)
  const classes = [...el.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && stableId(c) && !/^(css|sc|jsx)-/.test(c));
  if (classes.length) out.push({ type: 'css', value: `${tag}.${classes.slice(0, 2).map((c) => CSS.escape(c)).join('.')}` });

  // ทางสุดท้าย: CSS path จากบรรพบุรุษที่มี id หรือจาก body
  const parts: string[] = [];
  for (let n: Element | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n !== el && stableId(n.id)) {
      parts.unshift(`#${CSS.escape(n.id)}`);
      break;
    }
    const t = n.tagName.toLowerCase();
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n!.tagName) : [];
    parts.unshift(same.length > 1 ? `${t}:nth-of-type(${same.indexOf(n) + 1})` : t);
  }
  if (!parts[0]?.startsWith('#')) parts.unshift('body');
  out.push({ type: 'css', value: parts.join(' > ') });

  return out;
}

export interface VerifyOptions {
  /**
   * สำหรับ assertText ไม่ใช้ locator ที่อิงข้อความ เพราะถ้าข้อความเปลี่ยน
   * จะได้ error "หา element ไม่เจอ" แทนที่จะเป็น "ข้อความไม่ตรง"
   */
  avoidText?: boolean;
}

/** หา locator ทุกตัวที่ยืนยันได้ว่าชี้ไปที่ element นี้ตัวเดียว เรียงตามลำดับความสำคัญ */
async function verifiedLocators(page: Page, el: Handle, { avoidText = false, max = 5 }: VerifyOptions & { max?: number } = {}): Promise<Locator[]> {
  const candidates = await el.evaluate(candidatesInPage);
  const found: Locator[] = [];
  for (const c of candidates) {
    if (avoidText && c.type === 'text') continue;
    try {
      const loc = toLocator(page, c);
      if ((await loc.count()) !== 1) continue;
      if (await loc.evaluate((f, target) => f === target, el)) found.push(c);
    } catch {
      // ตัวเลือกนี้ใช้ไม่ได้ (เช่น selector ไม่ถูกต้อง) ลองตัวถัดไป
    }
    if (found.length >= max) break;
  }
  return found;
}

export interface Target {
  locator: Locator;
  fallbacks?: Locator[];
  fingerprint: Fingerprint;
}

/** ข้อมูลเป้าหมายของ step: locator หลัก + ตัวสำรองและลายนิ้วมือสำหรับ self-healing */
export async function targetFor(page: Page, el: Handle, opts?: VerifyOptions): Promise<Target | null> {
  const [locator, ...fallbacks] = await verifiedLocators(page, el, opts);
  if (!locator) return null;
  const fingerprint = (await el.evaluate(fingerprintInPage)) as Fingerprint;
  return { locator, ...(fallbacks.length ? { fallbacks } : {}), fingerprint };
}

/**
 * กรอบไฮไลต์ element ใต้เมาส์ วาดในหน้าเว็บจริงจึงเห็นใน screencast
 * pointer-events: none ทำให้ไม่บัง elementFromPoint และการคลิก
 */
export function highlightAt(page: Page, x: number, y: number, color: string): Promise<void> {
  return page
    .evaluate(
      ({ x, y, selector, id, color }) => {
        let box = document.getElementById(id);
        const target = document.elementFromPoint(x, y);
        const el = target && target !== box ? target.closest(selector) || target : null;
        if (!el || el === document.body || el === document.documentElement) {
          box?.remove();
          return;
        }
        if (!box) {
          box = document.createElement('div');
          box.id = id;
          Object.assign(box.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', borderRadius: '3px' });
          document.documentElement.appendChild(box);
        }
        const r = el.getBoundingClientRect();
        Object.assign(box.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          outline: `2px solid ${color}`,
          background: `${color}22`,
        });
      },
      { x, y, selector: INTERACTIVE, id: HIGHLIGHT_ID, color }
    )
    .catch(() => {});
}

export function clearHighlight(page: Page): Promise<void> {
  return page
    .evaluate(
      ({ id, attr }) => {
        document.getElementById(id)?.remove();
        document.querySelectorAll(`[${attr}]`).forEach((n) => n.remove());
      },
      { id: HIGHLIGHT_ID, attr: MATCH_ATTR }
    )
    .catch(() => {});
}

/** ทดสอบ locator: นับจำนวนที่เจอ และไฮไลต์ทุกตัว (สีเหลือง) ให้ผู้ใช้เห็นว่าชี้ไปที่ไหน */
export async function highlightLocator(page: Page, loc: Locator): Promise<number> {
  await clearHighlight(page);
  const locator = toLocator(page, loc);
  const count = await locator.count();
  await locator.evaluateAll((els, attr) => {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.setAttribute(attr, '');
      Object.assign(box.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483647',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        outline: '2px solid #eab308',
        background: '#eab30833',
        borderRadius: '3px',
      });
      document.documentElement.appendChild(box);
    }
  }, MATCH_ATTR);
  return count;
}
