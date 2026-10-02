// จุดเริ่มต้นของ runner: อ่านค่าตั้ง -> ต่อฐานข้อมูล -> เปิด WebSocket
import { createServer } from 'node:http';
import { createCipher } from '@test-studio/core';
import { openStore, runMigrations } from '@test-studio/db';
import { loadConfig } from './config.js';
import { createRunner } from './server.js';

// โหลด .env ถ้ามี (ค่าที่ตั้งใน environment อยู่แล้วจะไม่ถูกทับ)
try {
  process.loadEnvFile(process.env.ENV_FILE || '.env');
} catch {
  // ไม่มีไฟล์ .env ก็ใช้ค่าจาก environment ได้
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const store = openStore({ url: config.databaseUrl, cipher: createCipher(null, { SECRET_KEY: config.secretKey }) });
if (config.runMigrations) {
  await runMigrations(store.db);
  console.log('migrate: เรียบร้อย');
}

const runner = await createRunner({ store, config });
const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return void res.end(JSON.stringify({ ok: true, sessions: runner.sessionCount }));
  }
  res.writeHead(404).end();
});
server.on('upgrade', runner.handleUpgrade);
server.listen(config.port, config.host, () => {
  console.log(`runner ฟังที่ http://${config.host}:${config.port} (WebSocket: /ws, health: /healthz)`);
});

// SIGTERM: platform อย่าง Docker/Vercel สั่งปิด instance (มีเวลาเก็บกวาดประมาณ 30 วินาที)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    server.close();
    await runner.close();
    await store.close();
    process.exit(0);
  });
}
