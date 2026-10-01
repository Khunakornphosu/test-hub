// โหลด .env ก่อนโมดูลอื่น: server.js ต้อง import ไฟล์นี้เป็นบรรทัดแรก
// เพราะ db.js ใช้ SECRET_KEY ตั้งแต่ตอนถูก import
// ค่าที่ตั้งไว้ใน environment อยู่แล้วจะไม่ถูกทับ, ENV_FILE=none ใช้ปิดการอ่าน .env (เช่น ตอนรันชุดเทส)
if (process.env.ENV_FILE !== 'none') {
  try {
    process.loadEnvFile(process.env.ENV_FILE || '.env');
  } catch {
    // ไม่มีไฟล์ .env ก็ทำงานได้ เพียงแต่ปิดฟีเจอร์ที่ต้องใช้ค่าเหล่านั้น เช่น AI
  }
}
