// logic ของ step ย้ายไปอยู่ใน packages/core (TypeScript + zod) แล้ว ไฟล์นี้แค่ส่งต่อให้ PoC ใช้งานได้ตามเดิม
// ต้อง build ก่อน: npm run build:core (จาก root ของ repo)
export * from '../packages/core/dist/steps/index.js';
