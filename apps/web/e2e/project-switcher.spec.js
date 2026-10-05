import { test, expect } from '@playwright/test';

const created = [];
test.afterEach(async ({ request }) => {
  const all = await request.get('/api/projects').then((r) => r.json());
  for (const p of all) if (created.includes(p.name)) await request.delete(`/api/projects/${p.id}`);
  created.length = 0;
});

async function project(request, name, tests) {
  created.push(name);
  const { id } = await request.post('/api/projects', { data: { name } }).then((r) => r.json());
  const ids = [];
  for (const t of tests) ids.push((await request.post(`/api/projects/${id}/tests`, { data: { name: t } }).then((r) => r.json())).id);
  return { id, ids };
}

test('สลับ สร้าง และลบโปรเจกต์จาก sidebar ทุกหน้าใช้โปรเจกต์เดียวกัน', async ({ page, request }) => {
  const stamp = Date.now();
  const a = await project(request, `E2E สวิตช์ A ${stamp}`, ['เทสของ A']);
  const b = await project(request, `E2E สวิตช์ B ${stamp}`, ['เทสของ B1', 'เทสของ B2']);
  await page.addInitScript((id) => { if (!localStorage.getItem('ts-project-set')) { localStorage.setItem('ts-project', String(id)); localStorage.setItem('ts-project-set', '1'); } }, a.id);

  const switcher = page.getByRole('button', { name: /^โปรเจกต์: / });
  await page.goto('/tests');
  await expect(switcher).toContainText(`E2E สวิตช์ A ${stamp}`);
  await expect(page.getByTestId('test-row')).toHaveCount(1);
  await expect(page.getByLabel('โปรเจกต์', { exact: true })).toHaveCount(0); // ไม่มี dropdown ในหน้าแล้ว

  await switcher.click();
  await page.getByRole('menuitem', { name: `E2E สวิตช์ B ${stamp}` }).click();
  await expect(switcher).toContainText(`E2E สวิตช์ B ${stamp}`);
  await expect(page.getByTestId('test-row')).toHaveCount(2);
  await expect(page.getByText(`โปรเจกต์ E2E สวิตช์ B ${stamp}`)).toBeVisible();

  // เปลี่ยนหน้าแล้วยังเป็นโปรเจกต์เดิม
  await page.getByRole('link', { name: 'ตั้งค่า' }).click();
  await expect(page.getByText(`E2E สวิตช์ B ${stamp}`).last()).toBeVisible();
  await expect(switcher).toContainText(`E2E สวิตช์ B ${stamp}`);

  // เปิดเทสของ A ตรงๆ: sidebar ตามโปรเจกต์ของเทส
  await page.goto(`/workspace?test=${a.ids[0]}`);
  await expect(switcher).toContainText(`E2E สวิตช์ A ${stamp}`);
  // สลับโปรเจกต์ขณะอยู่ใน Workspace: กลับไปหน้ารายการเทส
  await switcher.click();
  await page.getByRole('menuitem', { name: `E2E สวิตช์ B ${stamp}` }).click();
  await expect(page).toHaveURL(/\/tests$/);
  await expect(page.getByTestId('test-row')).toHaveCount(2);

  // สร้างโปรเจกต์ใหม่: เลือกให้ทันที
  const newName = `E2E สวิตช์ ใหม่ ${stamp}`;
  created.push(newName);
  await switcher.click();
  await page.getByRole('menuitem', { name: 'สร้างโปรเจกต์ใหม่' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill(newName);
  await page.getByRole('dialog').getByRole('button', { name: 'สร้าง', exact: true }).click();
  await expect(switcher).toContainText(newName);
  await expect(page.getByText('ยังไม่มีเทสเคสในโปรเจกต์นี้')).toBeVisible();

  // ลบโปรเจกต์ที่เลือกอยู่: ถอยไปโปรเจกต์อื่นเอง
  await switcher.click();
  await page.getByRole('menuitem', { name: `ลบโปรเจกต์ "${newName}"` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ลบ', exact: true }).click();
  await expect(switcher).not.toContainText(newName);
  expect((await request.get('/api/projects').then((r) => r.json())).some((p) => p.name === newName)).toBe(false);

  // เมนูย่อ: เหลือตัวอักษรย่อ
  const currentName = (await switcher.getAttribute('aria-label')).replace(/^โปรเจกต์: | \(กดเพื่อสลับ\)$/g, '');
  await page.getByRole('button', { name: 'ย่อเมนู' }).click();
  await expect(switcher).not.toContainText(currentName);
  await expect(switcher).toHaveAttribute('title', currentName);
  await page.getByRole('button', { name: 'ขยายเมนู' }).click();
});
