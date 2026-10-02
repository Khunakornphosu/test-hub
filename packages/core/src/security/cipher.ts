// เข้ารหัสตัวแปรลับ (AES-256-GCM)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENC_PREFIX = 'enc:v1:';

/**
 * key มาจาก SECRET_KEY ถ้าไม่ได้ตั้ง จะสร้างไฟล์ secret.key ในโฟลเดอร์ข้อมูลให้ (ควรย้ายไปเก็บที่อื่นเมื่อใช้งานจริง)
 * dataDir = null (เช่น ฐานข้อมูลในหน่วยความจำ) ใช้ key ชั่วคราวที่ไม่เขียนลงไฟล์
 */
function loadKey(dataDir: string | null, env: Record<string, string | undefined>): Buffer {
  if (env.SECRET_KEY) return crypto.createHash('sha256').update(env.SECRET_KEY).digest();
  if (!dataDir) return crypto.randomBytes(32);
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    console.warn(`[security] สร้าง key สำหรับเข้ารหัสตัวแปรลับที่ ${file} — เมื่อใช้งานจริงควรตั้ง SECRET_KEY ใน .env แทน`);
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
}

export interface Cipher {
  isEncrypted(stored: string): boolean;
  encrypt(text: string): string;
  /** ค่าเก่าที่ยังไม่เคยเข้ารหัสจะคืนกลับตามเดิม ส่วนข้อมูลที่ถูกแก้ไขจะโยน Error */
  decrypt(stored: string): string;
}

export function createCipher(dataDir: string | null, env: Record<string, string | undefined> = process.env): Cipher {
  const key = loadKey(dataDir, env);
  return {
    isEncrypted: (stored) => String(stored).startsWith(ENC_PREFIX),
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
      return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    decrypt(stored) {
      if (!String(stored).startsWith(ENC_PREFIX)) return stored; // ค่าเก่าก่อนมีการเข้ารหัส
      const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
