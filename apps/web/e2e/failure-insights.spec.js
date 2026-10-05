import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test_studio:test_studio@127.0.0.1:5433/test_studio';
let projectId;
test.afterEach(async ({ request }) => {
  if (projectId != null) await request.delete(`/api/projects/${projectId}`);
  projectId = undefined;
});

test('เทสที่พัง: เห็นสาเหตุที่น่าจะเป็น และเปิด Trace ในเว็บเราเองได้', async ({ page, request, baseURL }) => {
  test.setTimeout(150_000);
  ({ id: projectId } = await request.post('/api/projects', { data: { name: `E2E สาเหตุ ${Date.now()}` } }).then((r) => r.json()));
  const { id: testId } = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'หัวข้อผิด' } }).then((r) => r.json());
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql`update tests set steps = ${sql.json([
    { id: 1, action: 'goto', value: `${baseURL}/demo-login.html` },
    { id: 2, action: 'assertText', locator: { type: 'css', value: 'h1' }, expected: 'สมัครสมาชิก' },
  ])} where id = ${testId}`;
  await sql.end();

  const { id: batchId } = await request.post(`/api/projects/${projectId}/batches`, { data: { target: { type: 'test', id: testId }, environmentId: null } }).then((r) => r.json());
  await expect.poll(async () => (await request.get(`/api/batches/${batchId}`).then((r) => r.json())).status, { timeout: 90_000, intervals: [1000] }).toBe('done');

  await page.addInitScript((id) => localStorage.setItem('ts-project', String(id)), projectId);
  await page.goto(`/runs?batch=${batchId}&project=all`);
  await page.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  const detail = page.getByRole('region', { name: 'รายละเอียดการรัน' });
  await expect(detail.getByText('ข้อความไม่ตรง: คาดว่ามี "สมัครสมาชิก" แต่เจอ "เข้าสู่ระบบ"')).toBeVisible();
  const analysis = detail.getByTestId('failure-analysis');
  await expect(analysis).toContainText('สาเหตุที่น่าจะเป็น');
  await expect(analysis).toContainText('ทำต่อ:');
  await expect(analysis).toContainText(/วิเคราะห์โดย AI|จัดหมวดจากข้อความ error/);

  // trace ดาวน์โหลดได้จาก API และเปิดใน Trace Viewer ของเว็บเราเอง
  const { items } = await request.get(`/api/runs?batchId=${batchId}`).then((r) => r.json());
  const trace = await request.get(`/api/runs/${items[0].id}/trace`);
  expect(trace.status()).toBe(200);
  expect(trace.headers()['content-type']).toBe('application/zip');
  expect((await trace.body()).subarray(0, 2).toString()).toBe('PK');
  const [viewer] = await Promise.all([page.waitForEvent('popup'), detail.getByRole('button', { name: 'เปิด Trace' }).click()]);
  await expect(viewer).toHaveURL(/\/trace-viewer\/index\.html\?trace=/);
  await expect(viewer.getByText(/demo-login\.html/).first()).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText(/Expect|toContainText|innerText|waitFor|locator/i).first()).toBeVisible();
  expect(new URL(decodeURIComponent(viewer.url().split('trace=')[1])).origin).toBe(new URL(baseURL).origin);

  // ตัวกรองไม่เสถียรมีให้เลือก
  await expect(page.getByLabel('สถานะ', { exact: true }).getByText('ไม่เสถียร')).toBeVisible();
});
