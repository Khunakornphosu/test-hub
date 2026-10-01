// ชุดเทสของ Test Studio เอง: เปิด server จริง 2 ตัว (ไม่มี/มีรหัสผ่าน) กับ mock ของ Gemini
// ทุกตัวใช้ฐานข้อมูลในหน่วยความจำ จึงไม่แตะข้อมูลจริงใน data/
import { defineConfig } from '@playwright/test';

export const APP = 'http://127.0.0.1:4310';
export const AUTH_APP = 'http://127.0.0.1:4311';
export const MOCK_GEMINI = 'http://127.0.0.1:4319';

const serverEnv = {
  ENV_FILE: 'none', // ไม่อ่าน .env ของเครื่อง (กันคีย์จริงหลุดเข้ามาในเทส)
  DB_PATH: ':memory:',
  SECRET_KEY: 'test-secret-key',
};

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // ทุกเทสใช้ server ชุดเดียวกัน แต่ละเทสสร้างเทสเคสของตัวเอง จึงรันพร้อมกันได้
  workers: 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: APP,
    viewport: { width: 1600, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node tests/mock-gemini.mjs',
      url: `${MOCK_GEMINI}/__requests`,
      env: { PORT: '4319' },
    },
    {
      command: 'node server.js',
      url: `${APP}/api/auth`,
      env: {
        ...serverEnv,
        PORT: '4310',
        GEMINI_API_KEY: 'test-key',
        GEMINI_API_BASE: `${MOCK_GEMINI}/v1beta`,
      },
    },
    {
      command: 'node server.js',
      url: `${AUTH_APP}/login`,
      env: { ...serverEnv, PORT: '4311', APP_PASSWORD: 'letmein' },
    },
  ],
});
