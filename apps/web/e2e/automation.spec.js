import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test_studio:test_studio@127.0.0.1:5433/test_studio';

let projectId;
test.afterEach(async ({ request }) => {
  if (projectId != null) await request.delete(`/api/projects/${projectId}`);
  projectId = undefined;
});

test('รันอัตโนมัติ: environment, รันตอนนี้, ตั้งเวลา, แจ้งเตือน, CI token และดูผลของรอบ', async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  const name = `E2E อัตโนมัติ ${Date.now()}`;
  ({ id: projectId } = await request.post('/api/projects', { data: { name } }).then((r) => r.json()));
  const { id: testId } = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'หน้าเข้าสู่ระบบ' } }).then((r) => r.json());
  const steps = [
    { id: 1, action: 'goto', value: `${baseURL}/demo-login.html` },
    { id: 2, action: 'assertText', locator: { type: 'css', value: 'h1' }, expected: 'เข้าสู่ระบบ' },
  ];
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql`update tests set steps = ${sql.json(steps)} where id = ${testId}`;
  await sql.end();
  await page.addInitScript((id) => localStorage.setItem('ts-project', String(id)), projectId);

  await page.goto('/automation');
  await expect(page.getByRole('heading', { name: 'รันอัตโนมัติ' })).toBeVisible();
  await expect(page.getByText(`โปรเจกต์ ${name}`)).toBeVisible();

  // environment: base URL เดียวกับที่บันทึกไว้ ให้เทสยังผ่าน
  const envSection = page.getByRole('region', { name: 'Environment' });
  await envSection.getByRole('button', { name: 'เพิ่ม environment' }).click();
  await envSection.getByPlaceholder('เช่น staging').fill('local');
  await envSection.getByPlaceholder('https://staging.example.com').fill(baseURL);
  await envSection.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(envSection.getByTestId('environment-row')).toContainText('local');

  // รันตอนนี้ พร้อม environment: worker หยิบไปรันเอง
  await page.getByRole('button', { name: 'รันตอนนี้' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Environment').click();
  await page.getByRole('option', { name: /^local · / }).click();
  await dialog.getByRole('button', { name: 'รัน', exact: true }).click();
  const batches = page.getByRole('region', { name: 'รอบการรันล่าสุด' });
  await expect(batches.getByTestId('batch-row').first()).toContainText('สั่งรัน ทั้งโปรเจกต์');
  await expect(batches.getByTestId('batch-row').first()).toContainText('ผ่าน', { timeout: 60_000 });
  await expect(batches.getByTestId('batch-row').first()).toContainText('1/1');
  await expect(batches.getByTestId('batch-row').first()).toContainText('local');

  // ดูผลของรอบนี้ในหน้าผลการรัน
  await batches.getByRole('link', { name: 'ดูผล' }).first().click();
  await expect(page).toHaveURL(/\/runs\?batch=\d+&project=all/);
  await expect(page.getByText(/รอบการรัน #\d+ · สั่งรัน ทั้งโปรเจกต์/)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('หน้าเข้าสู่ระบบ');
  await page.goBack();

  // ตั้งเวลา: รายวัน จ.–ศ. 08:00 แล้วปิด/รันทันทีได้
  const schedules = page.getByRole('region', { name: 'ตั้งเวลา' });
  await schedules.getByRole('button', { name: 'ตั้งเวลาใหม่' }).click();
  await page.getByRole('dialog').getByPlaceholder('เช่น ทุกเช้าก่อนเข้างาน').fill('ทุกเช้า');
  await page.getByRole('dialog').getByRole('button', { name: 'บันทึก', exact: true }).click();
  const row = schedules.getByTestId('schedule-row');
  await expect(row).toContainText('ทุกเช้า');
  await expect(row).toContainText('จ.–ศ. 08:00');
  await expect(row).toContainText('ทั้งโปรเจกต์');
  await row.getByRole('switch').click({ force: true });
  await expect(row).toContainText('ปิดอยู่');
  await row.getByRole('button', { name: 'รัน ทุกเช้า ตอนนี้' }).click();
  await expect(batches.getByTestId('batch-row').first()).toContainText('ทุกเช้า');
  await expect(batches.getByTestId('batch-row').first()).toContainText('ผ่าน', { timeout: 60_000 });

  // แจ้งเตือน: ปลายทางแสดงแบบย่อ ไม่เห็น URL เต็ม และส่งทดสอบไปที่อยู่ภายในไม่ได้
  const channels = page.getByRole('region', { name: 'แจ้งเตือน' });
  await channels.getByRole('button', { name: 'เพิ่มช่องทาง' }).click();
  const channelDialog = page.getByRole('dialog');
  await channelDialog.getByText('Webhook', { exact: true }).click({ force: true });
  await channelDialog.getByPlaceholder('https://…').fill('https://10.0.0.5/hooks/very-secret-path-9999');
  await channelDialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  const channelRow = channels.getByTestId('channel-row');
  await expect(channelRow).toContainText('10.0.0.5/…9999');
  await expect(channelRow).not.toContainText('very-secret-path');
  await channelRow.getByRole('button', { name: 'ส่งทดสอบ' }).click();
  await expect(page.getByText(/ส่งไม่สำเร็จ: .*เครือข่าย/)).toBeVisible();

  // CI: สร้าง token แล้วเรียก API ด้วย token
  const ci = page.getByRole('region', { name: 'CI / API' });
  await ci.getByPlaceholder('เช่น GitHub Actions').fill('GitHub Actions');
  await ci.getByRole('button', { name: 'สร้าง token' }).click();
  const token = await page.getByLabel('token ที่สร้าง').inputValue();
  expect(token).toMatch(/^tsk_/);
  await page.getByRole('button', { name: 'เสร็จแล้ว' }).click();
  await expect(ci.getByTestId('token-row')).toContainText(token.slice(0, 10));

  expect((await request.post('/api/ci/runs', { data: {} })).status()).toBe(401);
  expect((await request.post('/api/ci/runs', { headers: { Authorization: 'Bearer tsk_wrong' }, data: {} })).status()).toBe(401);
  expect((await request.post('/api/ci/runs', { headers: { Authorization: `Bearer ${token}` }, data: { environment: 'ไม่มี' } })).status()).toBe(400);
  const started = await request.post('/api/ci/runs', { headers: { Authorization: `Bearer ${token}` }, data: { testId, environment: 'local' } });
  expect(started.status()).toBe(202);
  const { id: batchId, statusUrl } = await started.json();
  expect(statusUrl).toBe(`${baseURL}/api/ci/runs/${batchId}`);
  let status;
  await expect.poll(async () => {
    status = await request.get(`/api/ci/runs/${batchId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    return status.status;
  }, { timeout: 60_000, intervals: [1000] }).toBe('done');
  expect(status).toMatchObject({ passed: true, total: 1, failed: 0, environment: 'local' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'CI / API' }).getByTestId('token-row')).not.toContainText('—');
});
