import { test, expect } from '@playwright/test';

let projectId;
test.afterEach(async ({ request }) => {
  if (projectId != null) await request.delete(`/api/projects/${projectId}`);
  projectId = undefined;
});

test('step โค้ด: เขียน ลองรันกับหน้าเว็บ บันทึก รัน และ export', async ({ page, request, baseURL }) => {
  ({ id: projectId } = await request.post('/api/projects', { data: { name: `E2E ${Date.now()}` } }).then((r) => r.json()));
  const { id: testId } = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'โค้ด' } }).then((r) => r.json());
  await page.goto(`/workspace?test=${testId}`);
  await expect(page.getByText('เชื่อมต่อแล้ว')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('เลือก action เพื่อเพิ่ม step').click();
  await page.getByRole('option', { name: 'เปิดหน้าเว็บ', exact: true }).click();
  await page.locator('aside').getByRole('textbox', { name: 'URL' }).fill(`${baseURL}/demo-login.html`);
  const address = page.getByRole('textbox', { name: 'URL' }).first();
  await address.fill(`${baseURL}/demo-login.html`);
  await address.press('Enter');

  // เพิ่ม step โค้ดแล้วตัวแก้โค้ดเปิดเอง
  await page.getByLabel('เลือก action เพื่อเพิ่ม step').click();
  await page.getByRole('option', { name: 'รันโค้ด JavaScript', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('แก้โค้ด JavaScript')).toBeVisible();
  await expect(page.getByTestId('step-item').last()).toContainText('ยังไม่ได้เขียนโค้ด');

  // ตัวอย่าง + ลองรัน: หน้า demo ไม่มี "ยินดีต้อนรับ" จึงต้องไม่ผ่าน
  await drawer.getByRole('button', { name: 'ตรวจว่ามีข้อความ' }).click();
  await drawer.getByRole('button', { name: 'ลองรันกับหน้าเว็บตอนนี้' }).click();
  await expect(drawer.getByTestId('script-result')).toContainText('ไม่ผ่าน');
  await expect(drawer.getByTestId('script-result')).toContainText('โค้ดคืนค่า false');

  // พิมพ์โค้ดเองแล้วลองรันด้วยคีย์ลัด
  const code = drawer.locator('.cm-content');
  await code.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText("// หัวข้อต้องเป็นเข้าสู่ระบบ\nreturn document.querySelector('h1').textContent === 'เข้าสู่ระบบ';");
  await expect(drawer.getByText('ยังไม่ได้บันทึก')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(drawer.getByTestId('script-result')).toContainText('ทำงานสำเร็จ');
  await expect(drawer.getByTestId('script-result')).toContainText('true');

  await drawer.getByRole('button', { name: 'บันทึกโค้ด' }).click();
  await expect(page.getByTestId('step-item').last()).toContainText('รันโค้ด');
  await expect(page.getByTestId('step-item').last()).toContainText('หัวข้อต้องเป็นเข้าสู่ระบบ');
  await expect(drawer.getByText('ยังไม่ได้บันทึก')).toHaveCount(0);
  await drawer.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(page.getByTestId('script-preview')).toContainText("document.querySelector('h1')");

  await page.getByRole('button', { name: 'รัน', exact: true }).click();
  await expect(page.getByText(/รันผ่าน ใช้เวลา/)).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByLabel('โค้ด Playwright')).toHaveValue(/expect\(await page\.evaluate\(async \(\) => \{\n    \/\/ หัวข้อต้องเป็นเข้าสู่ระบบ/);
  await page.keyboard.press('Escape');

  // แท็บโค้ด: เห็นโค้ดทั้งเทส อ่านอย่างเดียว และอัปเดตเมื่อแก้ step
  await page.getByRole('tab', { name: 'โค้ด' }).click();
  const view = page.getByTestId('test-code-view');
  await expect(view).toContainText("test('โค้ด', async ({ page }) => {");
  await expect(view).toContainText(`await page.goto('${baseURL}/demo-login.html');`);
  await expect(view).toContainText("return document.querySelector('h1').textContent === 'เข้าสู่ระบบ';");
  await expect(page.getByTestId('browser-canvas')).toBeHidden();
  await view.locator('.cm-content').click();
  await page.keyboard.type('zzz');
  await expect(view).not.toContainText('zzz');

  await page.getByTestId('step-item').first().getByTestId('step-main').click();
  await page.locator('aside').getByRole('textbox', { name: 'URL' }).fill(`${baseURL}/demo-login.html?v=2`);
  await expect(view).toContainText(`await page.goto('${baseURL}/demo-login.html?v=2');`);

  await page.getByRole('tab', { name: 'เบราว์เซอร์' }).click();
  await expect(page.getByTestId('browser-canvas')).toBeVisible();
  await expect(view).toHaveCount(0);
});
