# Test Studio

เครื่องมือให้ Tester เขียนและรันเทสเว็บผ่าน GUI โดยมี Playwright เป็น engine ดูแนวคิดและขอบเขตใน [เอกสารไอเดีย](<Test Studio_ เอกสารไอเดียและขอบเขตงาน.md>)

## โครงสร้าง

```
 apps/web (Next.js + Grafana UI) ──token──▶ apps/runner (Node + Playwright)
        │  CRUD, ล็อกอิน                          │  เบราว์เซอร์, บันทึก, รันเทส
        └────────────────▶ Postgres ◀─────────────┘        (packages/db)
                 ทั้งสองส่วนใช้ logic ร่วมจาก packages/core
```

| โฟลเดอร์ | คืออะไร | สถานะ |
| --- | --- | --- |
| [packages/core](packages/core) | logic ร่วม (TypeScript + zod): schema ของ step, โปรโตคอล WebSocket, แปลงเป็นโค้ด/คำอธิบาย, รัน step + self-healing, AI (Gemini), กัน SSRF, เข้ารหัส, token | ✔ |
| [packages/db](packages/db) | Postgres + Drizzle: โปรเจกต์, เทสเคส, ตัวแปรลับ (เข้ารหัส), ประวัติการรัน + ตัวย้ายข้อมูลจาก PoC | ✔ |
| [apps/runner](apps/runner) | บริการ WebSocket ที่เปิด Chromium: screencast, บันทึก step, รันเทส, AI | ✔ ทำงานกับ UI ของ PoC ได้ครบ |
| [apps/web](apps/web) | Workspace, ผลการรัน, Dashboard และ secrets (Next.js + Grafana UI) | ต่อ API/runner แล้ว; Playwright E2E ผ่าน |
| [poc-screencast](poc-screencast) | ต้นแบบเดิมที่ใช้งานได้ครบ | ใช้ต่อไปจนกว่า apps/web ทำได้เท่ากัน |

## เริ่มใช้งาน

```bash
npm install
npm run db:up               # เปิด Postgres ใน Docker (พอร์ต 5433)
npm run build               # build core, db, runner
```

**ย้ายข้อมูลจาก PoC เดิม (ครั้งเดียว):**

```bash
export DATABASE_URL=postgres://test_studio:test_studio@127.0.0.1:5433/test_studio SECRET_KEY=<ตั้งเอง>
npm run db:migrate
npm run import-poc -w @test-studio/db -- ../../poc-screencast/data
```

ตัวแปรลับถอดรหัสด้วย key ของ PoC แล้วเข้ารหัสใหม่ด้วย `SECRET_KEY` นี้ (เก็บ key ไว้ให้ดี เปลี่ยนแล้วถอดรหัสของเดิมไม่ได้)

**รัน runner:** ดู [apps/runner/README.md](apps/runner/README.md)

**รันเว็บและ runner สำหรับ Step 3:** ดู [apps/web/README.md](apps/web/README.md) และ [docs/step3-handoff.md](docs/step3-handoff.md) (พอร์ตเว็บ 4700, runner 4800; ห้ามใช้ 3100)

## ทดสอบ

```bash
npm test                    # core + db + runner (ต้องเปิด Postgres ก่อน)
npm run test:poc            # ชุดเทส UI ของ PoC เดิม (44 เทส) บน server เดิม
npm run test:poc-on-runner  # ชุดเดียวกัน แต่ใช้ runner + Postgres ใหม่ (41 เทส ข้าม 3 ที่เป็นของ PoC โดยเฉพาะ)
```

เทส UI ของ PoC ทำหน้าที่เป็นตัววัดว่าระบบใหม่ทำงานเหมือนเดิม: `test:poc-on-runner` เปิดหน้าเว็บเดิมแต่เชื่อมกับ runner ใหม่ ถ้าผ่านแปลว่า runner/db ใหม่รองรับทุกพฤติกรรมที่เคยมี

## แนวทางที่ใช้

- **step JSON คือหัวใจ:** ทุกส่วนอ่าน/เขียนรูปแบบเดียวกันผ่าน `stepSchema` (zod) ทั้งฟอร์ม, API, ฐานข้อมูล และผลจาก AI
- **ตัวเดียวกันทั้งตอนรันและตอน export:** `runStep` และ `stepToCode` ใช้ตารางชนิด step เดียวกัน ผลที่รันในระบบจึงตรงกับโค้ดที่ส่งออก
- **ข้อความจากภายนอกไม่เชื่อ:** ทุกข้อความ WebSocket ที่เข้า runner ถูกตรวจด้วย zod และรหัสผ่านไม่ออกจาก runner/ฐานข้อมูลเป็นข้อความธรรมดา
