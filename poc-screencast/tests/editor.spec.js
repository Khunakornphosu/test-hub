// Step Editor: แก้ไข, เพิ่มเอง, เลือก element จากหน้าเว็บ, ลากสลับลำดับ และการเก็บข้อมูล
import { test, expect, DEMO_URL } from './helpers.js';

test('แก้ค่า step แล้วผลการรันเปลี่ยนตาม และบันทึกลงฐานข้อมูล', async ({ studio, page }) => {
  await studio.recordLogin();
  const editor = await studio.openEditor(4);
  await editor.getByLabel('ต้องมีข้อความ').fill('ข้อความที่ไม่มีจริง');
  await studio.saveEditor();

  expect(await studio.run()).toContain('ไม่ผ่านที่ step 5');
  await expect(page.locator('#steps .step-error')).toContainText('ข้อความไม่ตรง: คาดว่ามี "ข้อความที่ไม่มีจริง"');

  // โหลดหน้าใหม่ step ที่แก้ยังอยู่
  await page.reload();
  await expect(studio.stepTexts.nth(4)).toContainText('ข้อความที่ไม่มีจริง');
});

test('เพิ่ม step เอง เลือก element จากหน้าเว็บ และระบบทดสอบ locator ให้', async ({ studio, page, demo }) => {
  await expect(page.locator('#url')).toHaveValue(DEMO_URL);
  const editor = await studio.addStep('assertVisible');
  await expect(editor).toContainText('ยังไม่ได้เลือก element');

  await editor.getByRole('button', { name: 'เลือกจากหน้าเว็บ' }).click();
  await expect(studio.modeBanner).toContainText('คลิก element ในหน้าเว็บ');
  await studio.clickAt(demo.submit.x, demo.submit.y);

  await expect(editor.locator('.match')).toHaveText('พบ 1 ตัวในหน้านี้ (ไฮไลต์สีเหลือง)');
  await studio.saveEditor();
  await expect(studio.stepTexts.last()).toHaveText('ตรวจว่าเห็น ปุ่ม "เข้าสู่ระบบ"');
});

test('locator ที่เจอหลายตัวถูกเตือนตอนทดสอบ', async ({ studio, page }) => {
  await expect(page.locator('#url')).toHaveValue(DEMO_URL);
  const editor = await studio.addStep('click');
  await editor.locator('summary', { hasText: 'แก้ locator เอง' }).click();
  await editor.getByLabel('ประเภท locator').selectOption('css');
  await editor.getByLabel('ค่า locator').fill('input');
  await editor.getByRole('button', { name: 'ทดสอบ' }).click();
  await expect(editor.locator('.match')).toContainText(/พบ \d+ ตัว — ต้องเจาะจงให้เหลือ 1 ตัว/);
});

test('ลากสลับลำดับ step', async ({ studio }) => {
  await studio.recordLogin({ checkWelcome: false });
  const before = await studio.stepTexts.allInnerTexts();
  await studio.steps.nth(3).dragTo(studio.steps.nth(0), { targetPosition: { x: 40, y: 2 } });
  await expect(studio.stepTexts).toHaveText([before[3], before[0], before[1], before[2]]);
});

test('ข้อมูลที่ไม่ถูกต้องใน Step Editor แสดง error และไม่บันทึก', async ({ studio }) => {
  const editor = await studio.addStep('assertCount');
  await editor.getByLabel('ต้องเจอกี่ตัว').fill('สาม');
  await editor.getByRole('button', { name: 'บันทึก step' }).click();
  await expect(editor.locator('.form-error')).toHaveText('จำนวนต้องเป็นตัวเลข');
});

test('ประวัติการรันเก็บผลแต่ละครั้ง', async ({ studio, page }) => {
  await studio.recordLogin();
  await studio.run();
  await studio.run();
  await page.locator('.underline-nav button[data-panel=historyPanel]').click();
  await expect(page.locator('#history li')).toHaveCount(2);
  await expect(page.locator('#history li').first()).toContainText('ผ่าน');
});

// บั๊กที่เคยเจอ: ผลทดสอบ locator กลับมาระหว่างพิมพ์ ทำให้ editor render ใหม่ focus หลุด และค่าที่พิมพ์หาย
test('พิมพ์ต่อเนื่องใน editor ไม่หลุดแม้มี render ใหม่ระหว่างพิมพ์', async ({ studio, page }) => {
  await studio.recordLogin();
  const editor = await studio.openEditor(4);
  const input = editor.getByLabel('ต้องมีข้อความ');
  await input.click();
  await input.press('ControlOrMeta+a');
  await page.keyboard.type('ข้อความใหม่ทั้งหมด', { delay: 30 }); // พิมพ์ช้าเหมือนคน คร่อมจังหวะที่ผลทดสอบ locator กลับมา
  await expect(input).toHaveValue('ข้อความใหม่ทั้งหมด');
  await studio.saveEditor();
  await expect(studio.stepTexts.nth(4)).toContainText('ข้อความใหม่ทั้งหมด');
});

test('dropdown: เลือกจากรายการตัวเลือกจริงบนหน้าเว็บ ไม่ต้องรู้ value', async ({ studio, page, demo }) => {
  await expect(page.locator('#url')).toHaveValue(DEMO_URL);
  const editor = await studio.addStep('selectOption');
  await expect(editor).toContainText('เลือก dropdown จากหน้าเว็บก่อน');
  await editor.getByRole('button', { name: 'เลือกจากหน้าเว็บ' }).click();
  await studio.clickAt(demo.role.x, demo.role.y);

  const options = editor.getByLabel('ตัวเลือก');
  await expect(options.locator('option:not([disabled])')).toHaveText(['Tester', 'Developer', 'Project Manager']);
  await options.selectOption({ label: 'Project Manager' });
  await expect(editor).toContainText('ค่าที่ระบบใช้: pm');
  await studio.saveEditor();
  await expect(studio.stepTexts.last()).toHaveText('เลือก dropdown "บทบาท" "Project Manager"');
  expect(await studio.exportCode()).toContain(".selectOption('pm');");
});

test('dropdown: ถ้าไม่อยู่ในหน้าที่เปิด พิมพ์ชื่อที่เห็นได้และรันผ่าน', async ({ studio, page }) => {
  await studio.recordLogin({ role: 'Developer' });
  // ไปหน้าต้อนรับ (ไม่มี dropdown) แล้วแก้ step เลือกบทบาท
  await expect(page.locator('#url')).toHaveValue(/#welcome$/);
  const editor = await studio.openEditor(3);
  await expect(editor).toContainText('ไม่พบ dropdown นี้ในหน้าที่เปิดอยู่');
  await editor.getByLabel('ตัวเลือก').fill('Project Manager');
  await studio.saveEditor();
  await expect(studio.stepTexts.nth(3)).toHaveText('เลือก dropdown "บทบาท" "Project Manager"');
  // ตรวจข้อความต้อนรับใหม่ให้ตรงกับบทบาทที่เลือก
  const assertEditor = await studio.openEditor(5);
  await assertEditor.getByLabel('ต้องมีข้อความ').fill('(Project Manager)');
  await studio.saveEditor();
  expect(await studio.run()).toContain('ผ่านทุก step');
});
