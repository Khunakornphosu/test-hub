// สำรองฐานข้อมูลทันที: npm run db:backup (ใช้ค่าตั้งเดียวกับ runner ใน apps/runner/.env)
import { createCipher } from '@test-studio/core';
import { openStore } from '@test-studio/db';
import { createBackup, pruneBackups } from './backup.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile(process.env.ENV_FILE || '.env');
} catch {
  // ไม่มี .env ก็ใช้ค่าจาก environment
}
const config = loadConfig();
const backup = config.backup!;
const store = openStore({ url: config.databaseUrl, cipher: createCipher(null, { SECRET_KEY: config.secretKey }), max: 1 });
const started = Date.now();
try {
  const { file, bytes } = await createBackup(config.databaseUrl, backup);
  const removed = await pruneBackups(backup.dir, backup.keepDays);
  console.log(`สำรองแล้ว: ${file} (${Math.round(bytes / 1024)} KB)${removed.length ? ` · ลบไฟล์เก่า ${removed.length} ไฟล์` : ''}`);
  // บันทึกประวัติแบบไม่บังคับ: ฐานข้อมูลเปล่า (เช่น ก่อนกู้คืนเข้าเครื่องใหม่) ยังไม่มีตาราง backups
  await store.repos.backups.record({ file, bytes, ok: true, error: null, durationMs: Date.now() - started }).catch(() => console.warn('(ไม่ได้บันทึกประวัติการสำรอง: ฐานข้อมูลยังไม่มีตาราง)'));
} catch (err) {
  await store.repos.backups.record({ file: null, bytes: null, ok: false, error: (err as Error).message.slice(0, 500), durationMs: Date.now() - started }).catch(() => {});
  console.error(`สำรองไม่สำเร็จ: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await store.close();
}
