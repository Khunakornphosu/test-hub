// คัดลอกไฟล์ของแพ็กเกจที่หน้าเว็บต้องเสิร์ฟเองไปไว้ใน public/ (ไม่เก็บใน git)
// - ไอคอนของ @grafana/ui (component ขอไฟล์จาก /public/build/img/icons/...)
// - Trace Viewer ของ Playwright (/trace-viewer/) เปิด trace ในเว็บเราเอง ไม่ต้องส่งไฟล์ไปเว็บอื่น
// หาแพ็กเกจด้วย require.resolve เพราะใน monorepo npm อาจย้าย node_modules ขึ้นไปไว้ที่ root
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const packageDir = (name) => {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
};

const grafana = packageDir('@grafana/ui');
const icons = grafana && path.join(grafana, 'dist/public/img');
if (icons && existsSync(icons)) {
  mkdirSync('public/public/build', { recursive: true });
  cpSync(icons, 'public/public/build/img', { recursive: true });
}

const playwright = packageDir('playwright-core');
const viewer = playwright && path.join(playwright, 'lib/vite/traceViewer');
if (viewer && existsSync(viewer)) cpSync(viewer, 'public/trace-viewer', { recursive: true });
