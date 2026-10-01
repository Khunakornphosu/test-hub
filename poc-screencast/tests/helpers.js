// fixture และตัวช่วยสำหรับเทส UI ของ Test Studio
import { test as base, expect } from '@playwright/test';
import { APP } from '../playwright.config.js';

export { expect };
export const DEMO_URL = `${APP}/demo-login.html`;
const DEMO_SELECTORS = {
  email: '#email',
  password: '#password',
  role: '#role',
  remember: '#remember',
  submit: 'button',
};

/** ตัวช่วยควบคุมหน้า Test Studio ที่เปิดเทสเคสหนึ่งไว้ */
export class Studio {
  constructor(page, request, testId, demo) {
    this.page = page;
    this.request = request;
    this.testId = testId;
    this.demo = demo;
    this.steps = page.locator('#steps .step');
    this.stepTexts = page.locator('#steps .step-text');
    this.editor = page.locator('#steps .editor');
    this.runBanner = page.locator('#runBanner');
    this.modeBanner = page.locator('#modeBanner');
  }

  // คลิกบนหน้าเว็บใน canvas ด้วยพิกัดของ viewport จริง (1280x720)
  async clickAt(x, y) {
    const box = await this.page.locator('#screen').boundingBox();
    const scale = box.width / 1280;
    await this.page.mouse.click(box.x + x * scale, box.y + y * scale);
  }

  async clickDemo(name) {
    const { x, y } = this.demo[name];
    await this.clickAt(x, y);
  }

  async typeInto(name, text) {
    await this.clickDemo(name);
    await this.page.keyboard.type(text);
  }

  async navigate(url) {
    await this.page.fill('#url', url);
    await this.page.click('#go');
  }

  async startRecording() {
    await this.page.click('#record');
    await expect(this.modeBanner).toContainText('กำลังบันทึก');
  }

  async stopRecording() {
    await this.page.click('#record');
    await expect(this.modeBanner).not.toContainText('กำลังบันทึก');
  }

  async addAssertion(mode) {
    await this.page.click('#assertMenu summary');
    await this.page.click(`#assertMenu [data-mode=${mode}]`);
  }

  // บันทึก flow ล็อกอินบนหน้า demo
  async recordLogin({ email = 'somchai@test.com', password = 'pass1234', role, remember = false, checkWelcome = true } = {}) {
    await expect(this.page.locator('#url')).toHaveValue(DEMO_URL);
    await this.startRecording();
    await this.typeInto('email', email);
    await this.typeInto('password', password);
    if (role) {
      await this.clickDemo('role');
      await this.page.locator('#selectMenu div', { hasText: role }).dispatchEvent('mousedown');
    }
    if (remember) await this.clickDemo('remember');
    await this.clickDemo('submit');
    await expect(this.page.locator('#url')).toHaveValue(/#welcome$/);
    if (checkWelcome) {
      await this.addAssertion('assertText');
      await this.clickAt(640, 360);
      await expect(this.stepTexts.last()).toContainText('ตรวจข้อความ');
    }
    await this.stopRecording();
  }

  async runs() {
    return (await this.request.get(`/api/tests/${this.testId}/runs`)).json();
  }

  // กดรันแล้วรอจนผลถูกบันทึก คืนข้อความในแบนเนอร์ผลการรัน
  async run() {
    const before = (await this.runs()).length;
    await this.page.click('#run');
    await expect.poll(async () => (await this.runs()).length, { timeout: 30_000 }).toBe(before + 1);
    await expect(this.runBanner).toBeVisible();
    return (await this.runBanner.innerText()).replace(/\s+/g, ' ');
  }

  async openEditor(index) {
    const row = this.steps.nth(index);
    await row.hover();
    await row.getByRole('button', { name: 'แก้ไข step' }).click();
    await expect(this.editor).toBeVisible();
    return this.editor;
  }

  async saveEditor() {
    await this.editor.getByRole('button', { name: 'บันทึก step' }).click();
    await expect(this.editor).toHaveCount(0);
  }

  async addStep(action) {
    await this.page.selectOption('#newAction', action);
    await this.page.click('#addStep');
    await expect(this.editor).toBeVisible();
    return this.editor;
  }

  async setSecret(name, value, projectId = 1) {
    await this.request.put(`/api/projects/${projectId}/secrets/${name}`, { data: { value } });
  }

  async exportCode() {
    await this.page.click('#export');
    await this.page.locator('.seg button[data-tab=code]').click();
    const code = await this.page.locator('#exportBody').innerText();
    await this.page.click('#closeExport');
    return code;
  }
}

export const test = base.extend({
  // ตำแหน่ง element ในหน้า demo ที่ viewport 1280x720 (ขนาดเดียวกับเบราว์เซอร์ฝั่ง server)
  demo: [
    async ({ browser }, use) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(DEMO_URL);
      const positions = {};
      for (const [name, selector] of Object.entries(DEMO_SELECTORS)) {
        const b = await page.locator(selector).boundingBox();
        positions[name] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      await page.close();
      await use(positions);
    },
    { scope: 'worker' },
  ],

  // เทสเคสใหม่ของแต่ละเทส เปิดผ่านลิงก์ตรง /?test=ID
  studio: async ({ page, request, demo }, use, testInfo) => {
    const name = `${testInfo.title}`.slice(0, 60);
    const res = await request.post('/api/projects/1/tests', { data: { name } });
    const { id } = await res.json();
    await page.goto(`/?test=${id}`);
    await expect(page.locator('#conn')).toHaveText('เชื่อมต่อแล้ว');
    await expect(page.locator('#testName')).toHaveValue(name);
    await use(new Studio(page, request, id, demo));
  },
});

// สร้างเทสเคสพร้อมชื่อ คืน id
export async function createTest(request, name) {
  const res = await request.post('/api/projects/1/tests', { data: { name } });
  return (await res.json()).id;
}
