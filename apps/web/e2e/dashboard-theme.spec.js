import { test, expect } from '@playwright/test';

test('Dashboard panels follow the selected light and dark themes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ts-mode', 'light'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ภาพรวมการทดสอบ' })).toBeVisible();
  const panel = page.getByRole('heading', { name: 'การรันตามช่วงเวลา' }).locator('..');
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(24, 26, 31)');
  const lightBg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  const lightText = await panel.locator('h2').evaluate((el) => getComputedStyle(el).color);
  expect(lightBg).not.toBe(lightText);

  await page.getByRole('button', { name: 'สลับโหมดสว่าง/มืด' }).click();
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(24, 26, 31)');
});
