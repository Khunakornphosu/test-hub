// สร้างฐานข้อมูลเปล่าสำหรับเทส (ใช้ Postgres ใน docker compose) แล้วลบทิ้งตอนจบ
import postgres from 'postgres';
import { createDb, runMigrations } from '@test-studio/db';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://test_studio:test_studio@127.0.0.1:5433/postgres';
const name = `test_studio_runner_${process.pid}_${Date.now()}`;

export async function setup() {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
  } catch (err) {
    await admin.end();
    throw new Error(`เชื่อม Postgres ไม่ได้ — เปิดก่อนด้วย: docker compose up -d db (${(err as Error).message})`);
  }
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const handle = createDb(url, { max: 1 });
  await runMigrations(handle.db);
  await handle.close();
  process.env.TEST_DATABASE_URL = url;
}

export async function teardown() {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.end();
}
