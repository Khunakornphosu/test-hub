# แอปเว็บ Test Studio

แอป Next.js สำหรับจัดการเทสและโปรเจกต์, ใช้ Workspace เชื่อมกับ runner ผ่าน WebSocket, แสดงผลการรันและสถิติจาก Postgres รวมถึงจัดการ secrets โดยไม่ส่งค่ากลับมาแสดง

## รันในเครื่อง

จากโฟลเดอร์รากของ monorepo:

```bash
npm run db:up && npm run db:migrate
cp apps/web/.env.example apps/web/.env.local
# ตั้ง SECRET_KEY ให้ตรงกับ apps/runner/.env และให้ runner มี APP_PORT=4700
npm run dev:runner
npm run dev:web
```

เว็บเปิดที่ `http://localhost:4700` และ runner ใช้ `ws://localhost:4800/ws` กำหนด `ALLOWED_ORIGINS=http://localhost:4700` ใน `apps/runner/.env` อย่าใช้พอร์ต 3100

## ตรวจเว็บ

```bash
npx tsc --noEmit
npm test
```

Playwright E2E ต้องใช้ web, runner และ Postgres test DB ที่รันอยู่ ดูวิธีเริ่มบริการและข้อควรระวังที่ [`docs/step3-handoff.md`](../../docs/step3-handoff.md)
