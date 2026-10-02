// คัดลอกไอคอนของ @grafana/ui ไปไว้ใน public/ (component ขอไฟล์จาก /public/build/img/icons/...)
// หาแพ็กเกจด้วย require.resolve เพราะใน monorepo npm อาจย้าย node_modules ขึ้นไปไว้ที่ root
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pkgDir;
try {
  pkgDir = path.dirname(require.resolve('@grafana/ui/package.json'));
} catch {
  process.exit(0);
}
const from = path.join(pkgDir, 'dist/public/img');
if (!existsSync(from)) process.exit(0);
mkdirSync('public/public/build', { recursive: true });
cpSync(from, 'public/public/build/img', { recursive: true });
