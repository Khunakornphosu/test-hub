# Step 3 — เชื่อม apps/web กับ runner + Postgres (เอกสารส่งต่องาน)

อัปเดต: 2026-10-02 · ผู้ใช้เป็นคนไทย ตอบและเขียนข้อความใน UI เป็นภาษาไทย

## เป้าหมาย
เปลี่ยน `apps/web` จาก prototype (mock data) เป็นของจริง: รายการเทส → Workspace (หน้าเว็บสดจาก runner ผ่าน WebSocket) → ผลการรัน → Dashboard จากข้อมูลจริง → ตั้งค่า (secrets) แล้วเขียน E2E test
Step 4 (ภายหลัง): Google login (Auth.js), Neon Postgres, Vercel — ต้องรอผู้ใช้ให้ Google OAuth client และตอบว่าจำกัดแค่อีเมลบริษัทหรือใช้ allowlist

## โครงสร้าง
- `packages/core` — step schema (zod), sanitize/describe/codegen, protocol (WS), security. ฝั่งเบราว์เซอร์ import จาก `@test-studio/core/client`
- `packages/db` — Drizzle + Postgres (repos: projects, tests, secrets, runs, stats)
- `apps/runner` — Node + Playwright, WebSocket `/ws` (token อายุ 60 วินาทีผ่าน `?token=`)
- `apps/web` — Next.js 16 + `@grafana/ui`, ทุก component ใช้ `dynamic(..., {ssr:false})`
- `poc-screencast` — ของเก่า ยังรันได้ ห้ามแตะจนกว่า web จะเทียบเท่า

## เสร็จแล้ว
- [x] db: `stats.overview`, `runs.listRecent`, เรียง `started_at desc, id desc` (tests ผ่าน 23)
- [x] runner: `APP_PORT`, `ready.ai` (tests ผ่าน 18) · core tests ผ่าน 50
- [x] web server: `src/server/{env,store,auth,route}.ts`
- [x] REST API `src/app/api/**` (ทดสอบด้วย curl กับ DB จริงแล้ว): projects, tests, secrets (คืนแต่ชื่อ), runs, stats, runner-token, health + CSRF Origin check
- [x] `src/lib/api.ts` (client), `src/lib/project.ts` (useProject), react-query ใน `GProviders`
- [x] หน้า "เทสเคส" `components/g/TestsPage.tsx` (สร้าง/เปลี่ยนชื่อ/ลบเทสและโปรเจกต์) — typecheck ผ่าน แต่ **ยังไม่ได้ดูในเบราว์เซอร์/ยังไม่มี E2E**
- [x] `src/lib/runner.ts` — hook `useRunner` (ขอ token, ต่อ WS, reconnect แบบ backoff, ส่ง `openTest` ซ้ำหลัง `ready`, เก็บ state/run) — typecheck ผ่าน ยังไม่ได้ทดสอบจริง
- [x] `components/g/BrowserView.tsx` — canvas + เมาส์/wheel/IME/คีย์บอร์ด/เมนู dropdown (พอร์ตจาก `poc-screencast/public/index.html` บรรทัด ~1378–1475)

## ยังต้องทำ (ตามลำดับ)
1. **Workspace จริง** แทน `components/g/Workspace.tsx` (ตอนนี้ mock) และอ่าน `?test=<id>` จาก URL (ลิงก์จากหน้ารายการใช้รูปนี้แล้ว)
   - แถบ toolbar: ชื่อเทส (เปลี่ยนชื่อผ่าน `api.renameTest`), โหมด (`mode` message: interact/assertVisible/assertText/assertURL/pick), บันทึก (`record`), AI, รัน (`run`), Export
   - แถบ URL (`navigate/back/forward/reload`, แสดง `url` จาก runner)
   - รายการ step ลากสลับด้วย dnd-kit (`moveStep`), badge สุขภาพ (`editor.health`), กล่อง self-heal (ปุ่มยอมรับ → `acceptHeal`), ลบ (`deleteStep`), เพิ่ม (`insertStep`)
   - Step editor สร้างฟอร์มจาก `ready.actions` (`ACTIONS`): locator picker (`pick` → `picked`), `testLocator`→`locatorTest`, dropdown options (`selectOptions`), fill+secret (`updateStep` พร้อม `secretValue`), `useTest` เลือกเทสอื่น
   - แบนเนอร์สถานะรัน (`runStart/runStep/runDone`), dialog AI (`aiGenerate`→`aiResult`→`aiAccept`; ถ้า `ready.ai.enabled` เป็น false ให้บอกว่ายังไม่ได้ตั้งค่า), dialog Export (`export`→โค้ด+JSON)
   - toast เมื่อ reconnect (`onReconnected`), แสดงสถานะ `conn`
2. **หน้า ผลการรัน**: ต้องเพิ่ม API ที่ยังไม่มี/ใช้ของที่มี `GET /api/runs`, `GET /api/runs/[id]` (+ `/screenshot`) แสดงรายการ, รายละเอียดทีละ step, screenshot
3. **Dashboard** ใน `components/g/Dashboard.tsx` ต่อ `GET /api/stats?from&to&projectId` (ช่วงเวลา, series, slowest, timeline, failures)
4. **หน้า ตั้งค่า**: จัดการ secrets (`api.secrets/setSecret/deleteSecret`; ห้ามแสดงค่าเดิม)
5. หน้า demo `apps/web/public/demo-login.html` (ใช้เป็นเป้าหมายเทสใน E2E; runner ต้องตั้ง `APP_PORT` = พอร์ตของ web เพื่อยกเว้น URL guard)
6. **E2E ของ web** (Playwright; web + runner + Postgres test DB) ครอบ: สร้างเทส → บันทึก flow login → รัน ผ่าน → ลบ step ให้พัง → เห็น error + screenshot → export → reconnect → dashboard มีตัวเลข
7. อัปเดต `README.md` รากและ `apps/web/README`; commit ทีละส่วน

## วิธีรัน dev
```
colima start            # ถ้า docker daemon ไม่ทำงาน
npm run db:up && npm run db:migrate
cp apps/web/.env.example apps/web/.env.local     # SECRET_KEY ต้องตรงกับ runner
# runner: apps/runner/.env ใส่ ALLOWED_ORIGINS=http://localhost:4700  APP_PORT=4700
npm run dev:runner      # พอร์ต 4800
npm run dev:web         # พอร์ต 4700
```
พอร์ตที่ใช้: web 4700 (dev), runner 4800, runner tests 4851, db 5433. **อย่าใช้ 3100** (โปรเจกต์อื่นของผู้ใช้ใช้อยู่) และ PoC เดิมอยู่ที่ 3000

## ข้อควรระวัง (เจอมาแล้ว)
- Next 16: `params` ใน route handler เป็น Promise (helper `route()` จัดการให้แล้ว)
- tsx/esbuild ใส่ `__name` ทำ `page.evaluate` พัง → มี shim ใน runner แล้ว
- Drizzle correlated subquery ต้องเขียน `"tests"."id"` เอง
- vitest ของ db: ทุกไฟล์ต้อง `resetDb()` เอง
- ไอคอน Grafana ต้อง sync (`apps/web/scripts/sync-assets.mjs`); มีไอคอนไม่ครบทุกชื่อ — เช็กชื่อกับ `IconName`
- `RadioButtonGroup` ของ Grafana: input ทับ label → ใน E2E คลิก input ด้วย `force`
- `PanelChrome` ที่ children เป็น function ต้องมีความกว้าง/สูงแน่นอน → ใช้ `Measured`
- `ConfirmModal` ไม่มี prop `icon`
- ห้ามพิมพ์/commit ค่าใน `poc-screencast/.env` (Gemini key, Vercel vars) และ `data/` ของผู้ใช้
- ข้อความ commit ลงท้ายด้วย `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- การรัน `npm test` ต้องผ่านทั้ง core/db/runner ก่อน commit; รัน `npx tsc --noEmit` ใน `apps/web` ด้วย
