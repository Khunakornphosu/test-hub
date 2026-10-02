# Test Studio

เครื่องมือให้ Tester เขียนและรันเทสเว็บผ่าน GUI โดยมี Playwright เป็น engine ดูแนวคิดและขอบเขตใน [เอกสารไอเดีย](<Test Studio_ เอกสารไอเดียและขอบเขตงาน.md>)

## โครงสร้าง

| โฟลเดอร์ | คืออะไร | สถานะ |
| --- | --- | --- |
| [packages/core](packages/core) | logic ร่วม (TypeScript + zod): schema ของ step, แปลงเป็นโค้ด/คำอธิบาย, รัน step ด้วย Playwright, self-healing, AI (Gemini), กัน SSRF, เข้ารหัสตัวแปรลับ | ✔ ใช้งานได้ มี 42 เทส |
| [apps/web](apps/web) | หน้าเว็บใหม่ (Next.js + ชุด UI ของ Grafana) | prototype ข้อมูลจำลอง กำลังต่อกับระบบจริง |
| [poc-screencast](poc-screencast) | ต้นแบบเดิมที่ใช้งานได้ครบ (Node + HTML ล้วน) | ใช้ต่อไปจนกว่าระบบใหม่จะทำได้เท่ากัน เรียกใช้ `packages/core` แทนโค้ดเดิมแล้ว |
| `apps/runner` | (ยังไม่มี) บริการที่เปิด Chromium, screencast, บันทึกและรันเทส | ขั้นที่ 2 |

## คำสั่งที่ใช้บ่อย

```bash
npm install                 # ติดตั้งทุก workspace (รันที่ root เท่านั้น)
npm run build:core          # build packages/core ไปที่ dist/ (ต้องทำก่อนรัน PoC)
npm run test:core           # เทสของ core (Vitest, ~35 วินาที)
npm run dev:web             # หน้าเว็บใหม่ที่ http://localhost:4700

cd poc-screencast && npm start     # PoC เดิมที่ http://localhost:3000
cd poc-screencast && npm test      # เทส PoC ผ่าน UI จริง (44 เทส)
```

## แนวทางที่ใช้

- **step JSON คือหัวใจ:** ทุกส่วนอ่าน/เขียนรูปแบบเดียวกันผ่าน `stepSchema` (zod) ทั้งฟอร์ม, API, ฐานข้อมูล และผลจาก AI
- **ตัวเดียวกันทั้งตอนรันและตอน export:** `runStep` และ `stepToCode` ใช้ตารางชนิด step เดียวกัน ผลที่รันในระบบจึงตรงกับโค้ดที่ส่งออก
- **ตรวจ core ผ่าน PoC:** เทส E2E ของ PoC เรียก core จริง จึงใช้เป็นตัววัดว่าการแก้ core ไม่ทำของเดิมพัง
