// คัดลอกไอคอนของ @grafana/ui ไปไว้ใน public/ (component ขอไฟล์จาก /public/build/img/icons/...)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const from = 'node_modules/@grafana/ui/dist/public/img';
if (!existsSync(from)) process.exit(0);
mkdirSync('public/public/build', { recursive: true });
cpSync(from, 'public/public/build/img', { recursive: true });
