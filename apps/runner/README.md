# Runner

บริการที่เปิด Chromium ให้ผู้ใช้ทีละคนผ่าน WebSocket: ส่งภาพหน้าเว็บสด (screencast), รับการคลิก/พิมพ์กลับ, บันทึกเป็น step, รันเทส และให้ AI สร้าง step
หน้าเว็บ (apps/web) ติดต่อ runner โดยตรง ส่วนข้อมูลทั้งหมดอยู่ใน Postgres ที่ทั้งสองฝั่งใช้ร่วมกัน

## รัน

```bash
cp .env.example .env        # ใส่ DATABASE_URL และ SECRET_KEY
npm run dev                 # จาก apps/runner (ใช้ tsx)
# หรือ production:
npm run build && npm start  # node dist/main.js
curl localhost:4800/healthz # {"ok":true,"sessions":0}
```

ค่าตั้งทั้งหมดอธิบายใน [.env.example](.env.example) ถ้าตั้งค่าผิด runner จะไม่ยอมเริ่มและบอกเหตุผลเป็นภาษาไทย

## การเชื่อมต่อ

`ws://<host>:<port>/ws?token=<token>` โดย

- **token:** หน้าเว็บออกให้ผู้ใช้ที่ล็อกอินแล้วด้วย `signRunnerToken(RUNNER_TOKEN_SECRET, อีเมลผู้ใช้)` จาก `@test-studio/core` อายุ 60 วินาที (ใช้เปิดการเชื่อมต่อครั้งเดียว) ถ้าไม่ตั้ง `RUNNER_TOKEN_SECRET` runner รับเฉพาะการเชื่อมจากเครื่องตัวเอง
- **Origin:** ต้องอยู่ใน `ALLOWED_ORIGINS` (ถ้าไม่ตั้ง ต้องเป็น origin เดียวกับ Host)
- **โปรโตคอล:** ข้อความขาเข้าตรวจด้วย zod ใน `packages/core/src/protocol.ts` ซึ่งเป็นแหล่งความจริงของรูปแบบข้อความทั้งสองทาง

## ความปลอดภัย

- เบราว์เซอร์ของ runner ผ่าน proxy ที่กันเครือข่ายภายใน/localhost/cloud metadata ทุก request รวม redirect (ถ้าต้องทดสอบเว็บภายใน ให้ระบุใน `ALLOWED_HOSTS`)
- ตัวแปรลับถอดรหัสเฉพาะในหน่วยความจำของ runner ตอนรันเทส ไม่ถูกส่งออกไปที่หน้าเว็บ (มีเทสตรวจ)
- จำกัดจำนวนผู้ใช้พร้อมกันด้วย `MAX_SESSIONS` ส่วนที่เกินจะได้ 503
- ข้อจำกัด: ทุก session ใช้ Chromium ตัวเดียวกัน (แยก context) ถ้าจะให้หลายทีมใช้ ควรแยก container ต่อทีม

## ทดสอบ

```bash
npm test                    # ต้องเปิด Postgres ก่อน (npm run db:up ที่ root)
```

- `tests/config.test.ts`: ค่าตั้งและการตัดสินใจอนุญาต WebSocket (Origin, token, Host, โควตา)
- `tests/runner.test.ts`: ของจริงทั้งชุด (WebSocket + Chromium + Postgres): บันทึก/รัน/เก็บผล, รหัสผ่านไม่รั่ว, SSRF, session แยกกัน

## dev/poc-host.ts

ตัวเชื่อมชั่วคราวที่ให้หน้าเว็บของ PoC เดิมใช้ runner + Postgres นี้ได้ (ใช้กับ `npm run test:poc-on-runner`) จะลบเมื่อ apps/web ต่อกับ runner ครบแล้ว
