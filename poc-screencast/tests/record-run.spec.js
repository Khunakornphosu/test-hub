// บันทึก -> รัน -> ดูผล -> Export (flow หลักตามเอกสาร MVP)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, DEMO_URL } from './helpers.js';

test('บันทึก flow ล็อกอินรวมภาษาไทย dropdown และ checkbox ได้ step ที่อ่านเข้าใจ', async ({ studio }) => {
  await studio.recordLogin({ email: 'สมชาย@test.com', role: 'Developer', remember: true });

  await expect(studio.stepTexts).toHaveText([
    `เปิด ${DEMO_URL}`,
    'พิมพ์ ช่อง "อีเมล" "สมชาย@test.com"',
    /^พิมพ์ ช่อง "รหัสผ่าน" •+ \(TEST_PASSWORD\)$/,
    'เลือก dropdown "บทบาท" "Developer"',
    'ติ๊ก checkbox "จดจำฉัน"',
    'คลิก ปุ่ม "เข้าสู่ระบบ"',
    'ตรวจข้อความ p.welcome มี "ยินดีต้อนรับ สมชาย@test.com (Developer)"',
  ]);
  expect(await studio.run()).toContain('ผ่านทุก step');
});

test('การพิมพ์ต่อเนื่องและ Backspace รวมเป็น step เดียว', async ({ studio, page }) => {
  await expect(page.locator('#url')).toHaveValue(DEMO_URL);
  await studio.startRecording();
  await studio.typeInto('email', 'abcx');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('d');
  await studio.stopRecording();
  await expect(studio.stepTexts).toHaveText([`เปิด ${DEMO_URL}`, 'พิมพ์ ช่อง "อีเมล" "abcd"']);
});

test('เทสพังแสดงตำแหน่ง ข้อความ error ภาษาไทย และ screenshot ในประวัติ', async ({ studio, page }) => {
  await studio.recordLogin();
  // ลบ step รหัสผ่าน: หน้าเว็บจะไม่ล็อกอิน ทำให้ step ตรวจข้อความพัง
  const pw = studio.steps.nth(2);
  await pw.hover();
  await pw.getByRole('button', { name: 'ลบ step' }).click();
  await expect(studio.steps).toHaveCount(4);

  expect(await studio.run()).toContain('ไม่ผ่านที่ step 4');
  await expect(page.locator('#steps .step.failed .step-error')).toContainText('5 วินาที');

  await studio.runBanner.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await expect(page.locator('#runBody .result')).toHaveCount(4);
  const shot = page.locator('#runBody img');
  await expect(shot).toBeVisible();
  expect(await shot.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
});

test('Export เป็นโค้ด Playwright ที่รันนอกระบบได้จริง', async ({ studio }, testInfo) => {
  await studio.recordLogin({ role: 'Developer' });
  const code = await studio.exportCode();
  expect(code).toContain("process.env.TEST_PASSWORD ?? ''");

  // รันโค้ดที่ export ด้วย @playwright/test แยกอีก process หนึ่ง
  const dir = testInfo.outputPath('exported');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'login.spec.ts'), code);
  // outputDir แยก ไม่งั้น process ลูกจะล้างโฟลเดอร์ test-results ของการรันนี้
  fs.writeFileSync(
    path.join(dir, 'playwright.config.mjs'),
    `export default { testDir: '.', outputDir: './out', reporter: 'line' };\n`
  );
  // ตัด env ของ test runner ตัวแม่ออก ให้ process ลูกเริ่มเหมือนรันเองจาก terminal
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEST_|PW_|PLAYWRIGHT_)/.test(k)));
  const output = execFileSync('npx', ['playwright', 'test', '--config', 'playwright.config.mjs'], {
    cwd: dir,
    env: { ...env, TEST_PASSWORD: 'pass1234' },
    encoding: 'utf8',
  });
  expect(output).toContain('1 passed');
});

test('การเชื่อมต่อหลุดแล้วต่อใหม่เอง step ยังอยู่และรันต่อได้', async ({ studio, page }) => {
  await studio.recordLogin();
  // จำลองการถูกตัดการเชื่อมต่อ (เช่น ครบเวลาสูงสุดของ function บน Vercel)
  await page.evaluate(() => ws.close());
  await expect(page.locator('#conn')).toHaveText('กำลังเชื่อมต่อใหม่…');
  await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
  await expect(page.locator('.Toast--warning')).toContainText('เชื่อมต่อใหม่แล้ว');
  await expect(studio.steps).toHaveCount(5);
  expect(await studio.run()).toContain('ผ่านทุก step');
});
