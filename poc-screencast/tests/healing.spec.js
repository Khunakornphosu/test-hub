// Self-healing: เว็บเปลี่ยนชื่อปุ่ม/ช่องกรอก (demo ?v2) แล้วระบบใช้ locator สำรองให้
import { test, expect, DEMO_URL } from './helpers.js';

test('ซ่อม locator อัตโนมัติ ผู้ใช้ยืนยัน แล้วรันครั้งต่อไปไม่ต้องซ่อม', async ({ studio, page }) => {
  await studio.recordLogin();
  expect(await studio.run()).toContain('ผ่านทุก step');

  // จำลองว่าเว็บถูกแก้
  const editor = await studio.openEditor(0);
  await editor.getByLabel('URL').fill(`${DEMO_URL}?v2`);
  await studio.saveEditor();

  expect(await studio.run()).toContain('ผ่าน แต่ซ่อม locator อัตโนมัติ 2 จุด');
  const heals = page.locator('#steps .heal-box');
  await expect(heals).toHaveCount(2);
  await expect(heals.nth(0)).toContainText('Placeholder: you@example.com');

  for (let i = 0; i < 2; i++) await heals.first().getByRole('button', { name: 'ใช้ locator ใหม่' }).click();
  await expect(heals).toHaveCount(0);
  await expect(studio.runBanner).toContainText('ผ่านทุก step');
  await expect(studio.stepTexts.nth(1)).toContainText('ช่อง "you@example.com"');

  expect(await studio.run()).toContain('ผ่านทุก step');
  // Locator health: เคยต้องซ่อม 1 ใน 3 การรัน
  await expect(page.locator('#steps .health')).toHaveText(['ซ่อม 1/3', 'ซ่อม 1/3']);
});

test('ข้อความที่เปลี่ยนจริงต้องพัง ไม่ถูก "ซ่อม" จนผ่าน', async ({ studio, page }) => {
  await studio.recordLogin({ email: 'a@test.com' });
  const editor = await studio.openEditor(1);
  await editor.getByLabel('ข้อความที่จะพิมพ์').fill('b@test.com');
  await studio.saveEditor();
  expect(await studio.run()).toContain('ไม่ผ่านที่ step 5');
  await expect(page.locator('#steps .heal-box')).toHaveCount(0);
});
