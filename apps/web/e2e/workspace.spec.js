import { test, expect } from '@playwright/test';

let createdProjectId;
test.afterEach(async ({ request }) => {
  if (createdProjectId == null) return;
  await request.delete(`/api/projects/${createdProjectId}`);
  createdProjectId = undefined;
});

test('สร้างและบันทึก login, รันผ่านและพัง, export, reconnect และดู Dashboard', async ({ page, request, baseURL }) => {
  const previous = await request.get('/api/projects').then((r) => r.json());
  for (const project of previous) {
    const generatedAt = /^E2E (\d+)$/.exec(project.name)?.[1];
    if (generatedAt && Date.now() - Number(generatedAt) < 60 * 60_000) await request.delete(`/api/projects/${project.id}`);
  }
  const projectRes = await request.post('/api/projects', { data: { name: `E2E ${Date.now()}` } });
  expect(projectRes.ok()).toBeTruthy();
  const { id: projectId } = await projectRes.json();
  createdProjectId = projectId;
  const testRes = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'ทดสอบเข้าสู่ระบบ' } });
  expect(testRes.ok()).toBeTruthy();
  const { id: testId } = await testRes.json();
  await page.goto(`/workspace?test=${testId}`);
  await expect(page.getByTestId('browser-canvas')).toBeVisible();
  await expect(page.getByText('เชื่อมต่อแล้ว')).toBeVisible({ timeout: 30_000 });
  // A newly inserted step should become active without requiring a second click.
  await page.getByLabel('เลือก action เพื่อเพิ่ม step').click();
  await page.getByRole('option', { name: 'คลิก', exact: true }).click();
  await expect(page.getByTestId('step-item')).toHaveCount(1);
  await expect(page.getByTestId('step-main')).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'ลบ step 1' }).click();
  await expect(page.getByTestId('step-item')).toHaveCount(0);
  const url = page.getByRole('textbox', { name: 'URL' });
  await url.fill(`${baseURL}/demo-login.html`);
  await url.press('Enter');
  const canvas = page.getByTestId('browser-canvas');
  await expect.poll(async () => await canvas.evaluate((c) => c.width)).toBe(1280);
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('ไม่พบ canvas ของเบราว์เซอร์');
  const clickRemote = async (x, y) => canvas.click({ position: { x: x / 1280 * box.width, y: y / 720 * box.height } });
  // หน้า demo ใช้ตำแหน่งฟอร์มคงที่ใน viewport 1280x720 ของ runner
  await clickRemote(640, 290);
  await page.keyboard.type('tester@test.local');
  await clickRemote(640, 370);
  await page.keyboard.type('secret-password');
  await clickRemote(640, 430);
  await expect(page.getByTestId('step-item')).toHaveCount(6, { timeout: 10_000 });
  const clickStep = page.getByTestId('step-item').filter({ hasText: 'คลิก' }).first();
  await clickStep.getByTestId('step-main').click();
  await page.getByRole('button', { name: 'เลือกจากหน้าเว็บ' }).click();
  await clickRemote(640, 290);
  await expect(page.getByTestId('step-locator')).toContainText('text: อีเมล', { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'ใช้ locator ที่เลือก' })).toHaveCount(0);
  // เก็บข้อมูลทดสอบผ่านหน้าจัดการ secrets โดย API จะคืนเฉพาะชื่อ
  await request.put(`/api/projects/${projectId}/secrets/E2E_PASSWORD`, { data: { value: 'secret-password' } });
  const secretNames = await request.get(`/api/projects/${projectId}/secrets`).then((r) => r.json());
  expect(secretNames).toContain('E2E_PASSWORD');
  expect(JSON.stringify(secretNames)).not.toContain('secret-password');

  // เพิ่ม assertion จากข้อความที่แสดงในหน้าเว็บ
  await page.getByTestId('data-testid radio-button-option assertText').click({ force: true });
  await clickRemote(640, 490);
  await page.getByTestId('data-testid radio-button-option interact').click({ force: true });
  await page.getByRole('button', { name: 'รัน', exact: true }).click();
  await expect(page.getByText(/รันผ่าน ใช้เวลา/)).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByLabel('โค้ด Playwright')).toBeVisible();
  await expect(page.getByLabel('ข้อมูล JSON')).toBeVisible();
  await page.keyboard.press('Escape');

  const submitStep = page.getByTestId('step-item').filter({ hasText: 'คลิก' }).last();
  await submitStep.getByRole('button', { name: /ลบ step/ }).click();
  await page.getByTestId('step-item').last().getByTestId('step-main').click();
  await page.getByLabel('ต้องมีข้อความ').fill('ข้อความที่ไม่มีอยู่จริง');
  await page.getByRole('button', { name: 'รัน', exact: true }).click();
  await expect(page.getByText('รันไม่ผ่าน — เปิดผลการรันเพื่อดูข้อผิดพลาดและภาพหน้าจอ')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'ดูผลการรัน' }).click();
  await expect(page).toHaveURL(/\/runs\?run=/);
  await expect(page.getByRole('heading', { name: 'ผลแต่ละขั้นตอน' })).toBeVisible();
  await expect(page.getByText(/ไม่พบ|ไม่ตรง|หา element/i)).toBeVisible();
  await expect(page.getByAltText('ภาพหน้าจอผลการรัน')).toBeVisible();

  // ตัดการเชื่อมต่อ WS แรกหลัง ready แล้วตรวจว่า Workspace ต่อใหม่ได้เอง
  let socketCount = 0;
  await page.routeWebSocket((wsUrl) => wsUrl.pathname === '/ws', (socket) => {
    const server = socket.connectToServer();
    socketCount += 1;
    if (socketCount === 1) {
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        socket.send(message);
        if (String(message).includes('"type":"ready"')) setTimeout(() => { server.close(); socket.close(); }, 50);
      });
    }
  });
  await page.goto(`/workspace?test=${testId}`);
  await expect.poll(() => socketCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('เชื่อมต่อแล้ว')).toBeVisible({ timeout: 30_000 });
  await page.goto('/');
  await expect(page.getByText('ภาพรวมการทดสอบ')).toBeVisible();
  await expect(page.getByText('จำนวนการรัน')).toBeVisible();
});
