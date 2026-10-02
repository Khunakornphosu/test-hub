import { createCipher } from '@test-studio/core';
import { openStore, runMigrations, type Store } from '@test-studio/db';
import { getEnv } from './env';

// เก็บไว้ใน globalThis เพื่อให้โหมด dev (hot reload) ไม่เปิดการเชื่อมต่อฐานข้อมูลเพิ่มทุกครั้งที่แก้โค้ด
const g = globalThis as unknown as { __testStudioStore?: Promise<Store> };

export function getStore(): Promise<Store> {
  g.__testStudioStore ??= (async () => {
    const env = getEnv();
    const store = openStore({ url: env.DATABASE_URL, cipher: createCipher(null, { SECRET_KEY: env.SECRET_KEY }), max: 5 });
    // สร้างตารางถ้ายังไม่มี (ปลอดภัยที่จะรันซ้ำ) ผู้ใช้จึงไม่ต้องรัน migrate เองตอนเริ่มใช้
    await runMigrations(store.db);
    return store;
  })().catch((err) => {
    g.__testStudioStore = undefined; // ล้มเหลวแล้วให้ลองใหม่ครั้งหน้า ไม่จำความล้มเหลวไว้ตลอด
    throw err;
  });
  return g.__testStudioStore;
}
