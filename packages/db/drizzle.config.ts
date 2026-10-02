import { defineConfig } from 'drizzle-kit';

// สร้าง migration จาก schema: npm run generate -w @test-studio/db
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://test_studio:test_studio@127.0.0.1:5433/test_studio' },
});
