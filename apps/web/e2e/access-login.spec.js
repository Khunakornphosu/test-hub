import { test, expect } from '@playwright/test';

// รันกับหน้าเว็บที่ตั้ง ACCESS_PASSWORD ไว้ (เช่น npm run share แล้วส่ง WEB_URL และ ACCESS_PASSWORD เดียวกันมา)
const PASSWORD = process.env.ACCESS_PASSWORD;
test.skip(!PASSWORD, 'ต้องตั้ง ACCESS_PASSWORD (และ WEB_URL ถ้าไม่ใช่ localhost:4700)');

test('รหัสผ่านทีม: ยังไม่ล็อกอินเข้าไม่ได้, รหัสผิดแจ้งเตือน, ล็อกอินแล้วกลับหน้าเดิม และออกจากระบบได้', async ({ page, request }) => {
  expect((await request.get('/api/projects')).status()).toBe(401);
  expect((await request.get('/demo-login.html')).status()).toBe(200);
  expect((await request.post('/api/login', { data: { password: PASSWORD }, headers: { Origin: 'https://evil.example' } })).status()).toBe(403);

  await page.goto('/tests?x=1');
  await expect(page).toHaveURL(/\/login\?next=%2Ftests%3Fx%3D1$/);
  await page.getByLabel('รหัสผ่านทีม').fill('wrong-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText('รหัสผ่านไม่ถูกต้อง')).toBeVisible();
  await expect(page.getByLabel('รหัสผ่านทีม')).toHaveValue('');

  await page.getByLabel('รหัสผ่านทีม').fill(PASSWORD);
  await page.getByLabel('รหัสผ่านทีม').press('Enter');
  await expect(page).toHaveURL(/\/tests\?x=1$/);
  await expect(page.getByRole('heading', { name: 'เทสเคส' })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === 'ts_access');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');

  // cookie ที่แก้ค่าเองใช้ไม่ได้
  await page.context().addCookies([{ ...cookie, value: `${Math.floor(Date.now() / 1000) + 9999}.forged` }]);
  await page.goto('/runs');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('รหัสผ่านทีม').fill(PASSWORD);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/runs$/);

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
