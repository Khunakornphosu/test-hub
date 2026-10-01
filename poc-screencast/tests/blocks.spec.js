// Reusable blocks: ใช้เทสอื่นซ้ำเป็น step
import { test, expect, createTest } from './helpers.js';

test('ใช้เทส Login ซ้ำในเทสอื่น รันผ่าน และ export เป็น test.step', async ({ studio, page, request }, testInfo) => {
  await studio.recordLogin();
  const loginId = studio.testId;
  const loginName = await page.locator('#testName').inputValue();

  const checkoutId = await createTest(request, `Checkout ${testInfo.workerIndex}-${Date.now()}`);
  await page.goto(`/?test=${checkoutId}`);
  await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
  studio.testId = checkoutId;

  const editor = await studio.addStep('useTest');
  await editor.getByLabel('เทสที่ใช้ซ้ำ').selectOption(String(loginId));
  await studio.saveEditor();
  await expect(studio.stepTexts).toHaveText([`ใช้ซ้ำ ${loginName} (5 steps)`]);

  expect(await studio.run()).toContain('ผ่านทุก step');
  const code = await studio.exportCode();
  expect(code).toContain(`await test.step('${loginName}', async () => {`);
  expect(code).toContain("await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();");
});

test('step ใน block พังแล้วบอกว่าพังที่ไหน และ block ที่วนกันเองถูกจับได้', async ({ studio, page, request }, testInfo) => {
  await studio.recordLogin();
  const loginId = studio.testId;
  const loginName = await page.locator('#testName').inputValue();
  const checkoutName = `Loop ${testInfo.workerIndex}-${Date.now()}`;
  const checkoutId = await createTest(request, checkoutName);

  // Checkout ใช้ Login ซ้ำ
  await page.goto(`/?test=${checkoutId}`);
  await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
  studio.testId = checkoutId;
  let editor = await studio.addStep('useTest');
  await editor.getByLabel('เทสที่ใช้ซ้ำ').selectOption(String(loginId));
  await studio.saveEditor();

  // ทำให้ step สุดท้ายของ Login พัง
  await page.goto(`/?test=${loginId}`);
  await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
  studio.testId = loginId;
  editor = await studio.openEditor(4);
  await editor.getByLabel('ต้องมีข้อความ').fill('ข้อความผิด');
  await studio.saveEditor();

  await page.goto(`/?test=${checkoutId}`);
  await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
  studio.testId = checkoutId;
  expect(await studio.run()).toContain('ไม่ผ่านที่ step 1');
  await expect(page.locator('#steps .step-error')).toContainText(`step 5 ใน "${loginName}": ข้อความไม่ตรง`);

  // Login เรียก Checkout ซึ่งเรียก Login กลับมา
  await page.goto(`/?test=${loginId}`);
  await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
  studio.testId = loginId;
  editor = await studio.openEditor(4);
  await editor.getByLabel('ต้องมีข้อความ').fill('ยินดีต้อนรับ');
  await studio.saveEditor();
  editor = await studio.addStep('useTest');
  await editor.getByLabel('เทสที่ใช้ซ้ำ').selectOption(String(checkoutId));
  await studio.saveEditor();
  expect(await studio.run()).toContain('ไม่ผ่านที่ step 6');
  await expect(page.locator('#steps .step-error')).toContainText(`"${loginName}" ถูกใช้ซ้ำวนกันเอง`);
});

test('เลือกเทสตัวเองเป็น block ไม่ได้', async ({ studio }) => {
  const editor = await studio.addStep('useTest');
  const values = await editor.getByLabel('เทสที่ใช้ซ้ำ').locator('option').evaluateAll((os) => os.map((o) => o.value));
  expect(values.length).toBeGreaterThan(1);
  expect(values).not.toContain(String(studio.testId));
});
