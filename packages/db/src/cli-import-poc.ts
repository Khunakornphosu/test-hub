// ใช้งาน: DATABASE_URL=... SECRET_KEY=... npm run import-poc -w @test-studio/db -- ../../poc-screencast/data [--force]
// ถ้า PoC ใช้ SECRET_KEY ของตัวเอง ให้ตั้ง POC_SECRET_KEY ด้วย (ไม่งั้นอ่านจาก data/secret.key)
import { createCipher } from '@test-studio/core';
import { openStore } from './index.js';
import { importPoc } from './import-poc.js';

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error('ระบุโฟลเดอร์ข้อมูลของ PoC เช่น ../../poc-screencast/data');
  process.exit(1);
}
if (!process.env.SECRET_KEY) {
  console.error('ต้องตั้ง SECRET_KEY (key เข้ารหัสตัวแปรลับของระบบใหม่) ก่อน');
  process.exit(1);
}
const store = openStore({ cipher: createCipher(null) });
try {
  const report = await importPoc(store, dir, { force: flags.includes('--force') });
  console.log(`นำเข้าแล้ว: โปรเจกต์ ${report.projects}, เทส ${report.tests}, ตัวแปรลับ ${report.secrets}, ประวัติการรัน ${report.runs}`);
  for (const s of report.skipped) console.warn(`ข้าม: ${s}`);
} finally {
  await store.close();
}
