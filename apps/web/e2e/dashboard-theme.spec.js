import { test, expect } from '@playwright/test';

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

test('Dashboard panels follow the selected light and dark themes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ts-mode', 'light'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ภาพรวมการทดสอบ' })).toBeVisible();
  const panel = page.getByRole('heading', { name: 'การรันตามช่วงเวลา' }).locator('..');
  const background = () => panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(async () => luminance(await background())).toBeGreaterThan(0.8);
  const lightBg = await background();
  const lightText = await panel.locator('h2').evaluate((el) => getComputedStyle(el).color);
  expect(lightBg).not.toBe(lightText);

  await page.getByRole('button', { name: 'สลับเป็นโหมดมืด' }).click();
  await expect.poll(async () => luminance(await background())).toBeLessThan(0.2);
  await expect(page.getByRole('button', { name: 'สลับเป็นโหมดสว่าง' })).toBeVisible();
});
