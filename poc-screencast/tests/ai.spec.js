// AI สร้าง step ผ่าน mock ของ Gemini (ไม่ใช้คีย์จริงและไม่ส่งข้อมูลออกนอกเครื่อง)
import { test, expect, DEMO_URL } from './helpers.js';
import { MOCK_GEMINI } from '../playwright.config.js';

// mock เก็บคำตอบถัดไปไว้ที่เดียว จึงรันเทสในไฟล์นี้ทีละตัว
test.describe.configure({ mode: 'serial' });

const setReply = (request, reply) => request.post(`${MOCK_GEMINI}/__reply`, { data: reply });
const requests = async (request) => (await request.get(`${MOCK_GEMINI}/__requests`)).json();

const LOGIN_REPLY = {
  explanation: 'ล็อกอินและตรวจข้อความต้อนรับ',
  steps: [
    { action: 'goto', target: { by: 'none' }, url: DEMO_URL },
    { action: 'fill', target: { by: 'role', role: 'textbox', name: 'อีเมล' }, text: 'test@example.com' },
    { action: 'fill', target: { by: 'label', match: 'รหัสผ่าน' }, secret: 'TEST_PASSWORD' },
    { action: 'selectOption', target: { by: 'role', role: 'combobox', name: 'บทบาท' }, option: 'Developer' },
    { action: 'click', target: { by: 'role', role: 'button', name: 'เข้าสู่ระบบ' } },
    { action: 'assertText', target: { by: 'css', match: 'body' }, expected: 'ยินดีต้อนรับ' },
    { action: 'fill', target: { by: 'label', match: 'test@example.com' } }, // ใส่ค่าผิดช่อง: ต้องถูกตีตก
  ],
};

test('สร้าง step จากภาษาคน ตรวจกับหน้าเว็บ แล้วรันผ่าน', async ({ studio, page, request }) => {
  await expect(page.locator('#url')).toHaveValue(DEMO_URL);
  // พิมพ์รหัสผ่านไว้ในหน้าเว็บก่อน เพื่อตรวจว่าไม่ถูกส่งออกไปกับ snapshot
  await studio.typeInto('password', 'SuperSecret99');
  await setReply(request, { result: LOGIN_REPLY });

  await page.click('#aiBtn');
  await page.fill('#aiInstruction', 'ล็อกอินด้วย test@example.com เลือก Developer แล้วตรวจว่าเห็นคำว่ายินดีต้อนรับ');
  await page.click('#aiGenerate');
  const items = page.locator('#aiResult .ai-item');
  await expect(items).toHaveCount(7);
  await expect(page.locator('#aiModel')).toHaveText('· Gemini (gemini-3.8-flash)');
  await expect(items.locator('.ai-check')).toHaveText([
    'ไม่ต้องใช้ element',
    'พบ element ในหน้านี้',
    'พบ element ในหน้านี้',
    'พบ element ในหน้านี้',
    'พบ element ในหน้านี้',
    'พบ element ในหน้านี้',
    'ใช้ไม่ได้: ไม่ได้ระบุข้อความที่จะพิมพ์',
  ]);
  await expect(page.locator('#aiResult .btn-primary')).toHaveText('เพิ่ม 6 step ต่อท้ายเทส');
  await page.locator('#aiResult .btn-primary').click();
  await expect(studio.steps).toHaveCount(6);

  await studio.setSecret('TEST_PASSWORD', 'pass1234');
  expect(await studio.run()).toContain('ผ่านทุก step');

  // สิ่งที่ส่งไป Gemini: มี schema, เลือกรุ่น Flash ล่าสุดที่ไม่ใช่ preview/lite, ไม่มีรหัสผ่านที่พิมพ์ไว้
  const generate = (await requests(request)).filter((r) => r.url.includes(':generateContent')).at(-1);
  expect(generate.url).toBe('/v1beta/models/gemini-3.8-flash:generateContent');
  expect(generate.key).toBe('test-key');
  expect(generate.body.generationConfig.responseSchema).toBeTruthy();
  expect(JSON.stringify(generate.body)).not.toContain('SuperSecret99');
  expect(generate.body.contents[0].parts[0].text).toContain('textbox "รหัสผ่าน"');
});

test('Gemini ไม่ว่างหรือเกินโควตา แสดงข้อความภาษาไทย', async ({ page, request }) => {
  await page.goto('/');
  await page.click('#aiBtn');
  await page.fill('#aiInstruction', 'ทดสอบ');

  await setReply(request, { status: 429, body: { error: { message: 'quota' } } });
  await page.click('#aiGenerate');
  await expect(page.locator('#aiError')).toContainText('เกินโควตาฟรีของ Gemini');
  await expect(page.locator('#aiGenerate')).toBeEnabled();

  await setReply(request, { status: 400, body: { error: { message: 'API key not valid.' } } });
  await page.click('#aiGenerate');
  await expect(page.locator('#aiError')).toHaveText('GEMINI_API_KEY ไม่ถูกต้อง');
});
