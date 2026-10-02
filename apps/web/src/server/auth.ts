// ผู้ใช้ปัจจุบันของ request
// ขั้นนี้ยังไม่มีระบบล็อกอิน (ขั้น 4: Google login) จึงให้ผู้ใช้ทุกคนเป็น "dev" และเปิดใช้ได้เฉพาะตอนพัฒนา:
// production ต้องเปลี่ยนเป็นการตรวจ session จริง ไม่เช่นนั้น API ทั้งหมดจะไม่ยอมทำงาน (ปลอดภัยไว้ก่อน)
export interface User {
  email: string;
}

export function getUser(_req: Request): User | null {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ANONYMOUS_DEV_USER !== 'true') return null;
  return { email: 'dev@localhost' };
}
