import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node',
    // ทุกไฟล์เทสใช้ฐานข้อมูลเดียวกัน (และบางไฟล์ล้างตาราง) จึงรันทีละไฟล์
    fileParallelism: false, globalSetup: ['tests/global-setup.ts'], testTimeout: 20000 } });
