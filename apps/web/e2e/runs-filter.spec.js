import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test_studio:test_studio@127.0.0.1:5433/test_studio';
const created = [];
test.afterEach(async ({ request }) => {
  for (const id of created.splice(0)) await request.delete(`/api/projects/${id}`);
});

async function seed(request, name, runsByTest) {
  const { id: projectId } = await request.post('/api/projects', { data: { name } }).then((r) => r.json());
  created.push(projectId);
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  const ids = {};
  try {
    for (const [testName, outcomes] of Object.entries(runsByTest)) {
      const { id } = await request.post(`/api/projects/${projectId}/tests`, { data: { name: testName } }).then((r) => r.json());
      ids[testName] = id;
      for (const [i, passed] of outcomes.entries()) {
        await sql`insert into runs (test_id, started_at, duration_ms, passed, results) values (${id}, ${new Date(Date.UTC(2099, 0, 1, 0, i))}, 500, ${passed}, '[]'::jsonb)`;
      }
    }
  } finally {
    await sql.end();
  }
  return { projectId, ids };
}

test('กรองผลการรันตามโปรเจกต์ เทส และสถานะ พร้อมจำตัวกรองไว้ใน URL', async ({ page, request }) => {
  const stamp = Date.now();
  const a = await seed(request, `E2E A ${stamp}`, { 'เข้าสู่ระบบ': [true, true, false], 'สั่งซื้อ': [false, true] });
  const b = await seed(request, `E2E B ${stamp}`, { 'อื่นๆ': [true] });
  await page.addInitScript((id) => localStorage.setItem('ts-project', String(id)), a.projectId);

  await page.goto('/runs');
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(page.locator('thead')).not.toContainText('โปรเจกต์');

  await page.getByLabel('สถานะ', { exact: true }).getByText('ไม่ผ่าน', { exact: true }).click({ force: true });
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL(/status=failed/);

  await page.getByLabel('เทส', { exact: true }).click();
  await page.getByRole('option', { name: 'สั่งซื้อ', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('สั่งซื้อ');
  await expect(page).toHaveURL(new RegExp(`test=${a.ids['สั่งซื้อ']}`));

  // โหลดหน้าใหม่แล้วตัวกรองยังอยู่
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('ไม่ผ่าน');

  await page.getByRole('button', { name: 'ล้างตัวกรอง' }).first().click();
  await expect(rows).toHaveCount(5);
  await expect(page).not.toHaveURL(/status=|test=/);

  // ไม่พบตามตัวกรอง
  await page.getByLabel('เทส', { exact: true }).click();
  await page.getByRole('option', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.getByLabel('สถานะ', { exact: true }).getByText('ไม่ผ่าน', { exact: true }).click({ force: true });
  await expect(rows).toHaveCount(1);
  await page.getByLabel('สถานะ', { exact: true }).getByText('ผ่าน', { exact: true }).click({ force: true });
  await expect(rows).toHaveCount(2);

  // ทุกโปรเจกต์: มีคอลัมน์โปรเจกต์ และเห็นของโปรเจกต์ B ด้วย
  await page.getByLabel('ขอบเขต', { exact: true }).getByText('ทุกโปรเจกต์', { exact: true }).click({ force: true });
  await expect(page.locator('thead')).toContainText('โปรเจกต์');
  await expect(page.locator('tbody')).toContainText(`E2E B ${stamp}`);
  await expect(page).toHaveURL(/project=all/);

  // กลับมาโปรเจกต์นี้ แล้วสลับโปรเจกต์จาก sidebar: ตัวกรองเทสของโปรเจกต์เดิมถูกล้าง
  await page.getByLabel('ขอบเขต', { exact: true }).getByText('โปรเจกต์นี้', { exact: true }).click({ force: true });
  await page.getByLabel('เทส', { exact: true }).click();
  await page.getByRole('option', { name: 'สั่งซื้อ', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: /^โปรเจกต์: / }).click();
  await page.getByRole('menuitem', { name: `E2E B ${stamp}` }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('อื่นๆ');
  await expect(page).not.toHaveURL(/test=/);
});

test('ไม่มีผลตามตัวกรอง แสดงข้อความและปุ่มล้างตัวกรอง', async ({ page, request }) => {
  const { projectId } = await seed(request, `E2E C ${Date.now()}`, { 'ผ่านตลอด': [true, true] });
  await page.addInitScript((id) => localStorage.setItem('ts-project', String(id)), projectId);
  await page.goto('/runs?status=failed');
  await expect(page.getByText('ไม่พบผลการรันตามตัวกรองนี้')).toBeVisible();
  await page.getByRole('button', { name: 'ล้างตัวกรอง' }).last().click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});
