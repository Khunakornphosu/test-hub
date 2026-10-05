import { test, expect } from '@playwright/test';

test('หน้าตั้งค่าแสดงสถานะการสำรองข้อมูล ไม่เผย path ของเครื่อง', async ({ page, request }) => {
  const data = await request.get('/api/backups').then((r) => r.json());
  for (const b of data.items) expect(b.file ?? '').not.toContain('/');
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'สำรองข้อมูล' });
  await expect(section.getByRole('heading', { name: 'สำรองข้อมูล' })).toBeVisible();
  await expect(section).toContainText('npm run db:restore');
  if (data.lastSuccessAt && Date.now() - new Date(data.lastSuccessAt).getTime() < 2 * 86_400_000) {
    await expect(section.getByText(/^สำรองล่าสุด /)).toBeVisible();
    await expect(section.getByTestId('backup-row').first()).toContainText('สำเร็จ');
  } else {
    await expect(section.getByText(/ไม่ได้สำรองข้อมูลมาตั้งแต่|ยังไม่เคยสำรองข้อมูล/)).toBeVisible();
  }
});
