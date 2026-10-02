// ใช้งาน: DATABASE_URL=... npm run migrate -w @test-studio/db
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const handle = createDb(undefined, { max: 1 });
try {
  await runMigrations(handle.db);
  console.log('migrate: เรียบร้อย');
} finally {
  await handle.close();
}
