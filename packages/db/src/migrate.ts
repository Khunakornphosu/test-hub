import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './client.js';

/** โฟลเดอร์ SQL migration (อยู่ถัดจาก dist/ ทั้งตอนรันจาก src ด้วย tsx และจาก dist) */
const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS });
}
