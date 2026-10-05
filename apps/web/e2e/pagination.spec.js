import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test_studio:test_studio@127.0.0.1:5433/test_studio';
let projectId;

test.beforeEach(async ({ page, request }) => {
  ({ id: projectId } = await request.post('/api/projects', { data: { name: `E2E ${Date.now()}` } }).then((r) => r.json()));
  await page.addInitScript((id) => localStorage.setItem('ts-project', String(id)), projectId);
});
test.afterEach(async ({ request }) => {
  if (projectId != null) await request.delete(`/api/projects/${projectId}`);
  projectId = undefined;
});

test('ตารางเทสเคสแบ่งหน้า เปลี่ยนจำนวนต่อหน้า และกลับหน้าที่มีข้อมูลหลังลบ', async ({ page, request }) => {
  for (let i = 1; i <= 23; i++) await request.post(`/api/projects/${projectId}/tests`, { data: { name: `เทส ${String(i).padStart(2, '0')}` } });
  await page.goto('/tests');
  const rows = page.getByTestId('test-row');
  await expect(rows).toHaveCount(20);
  const pager = page.getByRole('navigation', { name: 'เปลี่ยนหน้า' });
  await expect(pager).toContainText('แสดง 1–20 จาก 23 เทส');

  await pager.getByRole('button', { name: 'หน้า 2', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(pager).toContainText('แสดง 21–23 จาก 23 เทส');

  await pager.getByLabel('จำนวนต่อหน้า').click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await expect(rows).toHaveCount(10);
  await expect(pager).toContainText('แสดง 1–10 จาก 23 เทส');
  await pager.getByRole('button', { name: 'หน้า 3', exact: true }).click();
  await expect(rows).toHaveCount(3);

  // ลบจนหน้า 3 ว่าง ต้องถอยกลับไปหน้าสุดท้ายที่มีข้อมูลเอง
  for (let i = 0; i < 3; i++) {
    await rows.first().getByRole('button', { name: 'ลบ', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ลบ', exact: true }).click();
    await expect(rows).toHaveCount(2 - i > 0 ? 2 - i : 10);
  }
  await expect(pager).toContainText('แสดง 11–20 จาก 20 เทส');
});

test('ผลการรันแบ่งหน้าจาก server', async ({ page, request }) => {
  const { id: testId } = await request.post(`/api/projects/${projectId}/tests`, { data: { name: 'มีประวัติเยอะ' } }).then((r) => r.json());
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // เวลาในอนาคตให้ทุกแถวอยู่หน้าแรกๆ ของรายการ (เรียงใหม่สุดก่อน)
    for (let i = 0; i < 45; i++) {
      await sql`insert into runs (test_id, started_at, duration_ms, passed, results) values (${testId}, ${new Date(Date.UTC(2099, 0, 1, 0, 45 - i))}, 1000, ${i % 3 !== 0}, '[]'::jsonb)`;
    }
  } finally {
    await sql.end();
  }
  await page.goto('/runs');
  const pager = page.getByRole('navigation', { name: 'เปลี่ยนหน้า' });
  await expect(pager).toContainText('แสดง 1–20 จาก 45 ครั้ง');
  const body = page.locator('tbody tr');
  await expect(body).toHaveCount(20);
  await expect(body.first()).toContainText('มีประวัติเยอะ');

  await pager.getByRole('button', { name: 'หน้า 2', exact: true }).click();
  await expect(pager).toContainText('แสดง 21–40 จาก 45 ครั้ง');
  await expect(body.first()).toContainText('มีประวัติเยอะ');
  await pager.getByLabel('จำนวนต่อหน้า').click();
  await page.getByRole('option', { name: '50', exact: true }).click();
  await expect(pager).toContainText('แสดง 1–45 จาก 45 ครั้ง');
  await expect(body).toHaveCount(45);
});

test('รายการ secret แบ่งหน้าเมื่อเกิน 10 รายการ', async ({ page, request }) => {
  for (let i = 1; i <= 12; i++) await request.put(`/api/projects/${projectId}/secrets/KEY_${String(i).padStart(2, '0')}`, { data: { value: 'x' } });
  await page.goto('/settings');
  const secretTable = page.getByRole('table').filter({ hasText: 'ค่าที่เก็บ' });
  const secretRows = secretTable.locator('tbody tr');
  const pager = page.getByRole('navigation', { name: 'เปลี่ยนหน้า' });
  await expect(pager).toContainText('แสดง 1–12 จาก 12 secret');
  await pager.getByLabel('จำนวนต่อหน้า').click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await expect(secretRows).toHaveCount(10);
  await pager.getByRole('button', { name: 'หน้า 2', exact: true }).click();
  await expect(secretRows).toHaveCount(2);
  await expect(secretTable).toContainText('KEY_12');
});
