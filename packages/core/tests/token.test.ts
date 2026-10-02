import { describe, expect, it } from 'vitest';
import { signRunnerToken, verifyRunnerToken } from '../src/index.js';

describe('runner token', () => {
  const secret = 'shared-secret';
  const now = 1_000_000;

  it('ออกแล้วตรวจผ่าน และได้ผู้ใช้กลับมา (รวมอักขระไทย/จุด)', () => {
    const token = signRunnerToken(secret, 'สมชาย.ใจดี@example.com', 60_000, now);
    expect(verifyRunnerToken(secret, token, now + 1000)).toEqual({ sub: 'สมชาย.ใจดี@example.com', exp: now + 60_000 });
  });

  it('หมดอายุแล้วใช้ไม่ได้', () => {
    const token = signRunnerToken(secret, 'a@b.c', 60_000, now);
    expect(verifyRunnerToken(secret, token, now + 59_999)).not.toBeNull();
    expect(verifyRunnerToken(secret, token, now + 60_001)).toBeNull();
  });

  it('secret ผิด ถูกแก้ผู้ใช้/เวลา หรือรูปแบบผิด ใช้ไม่ได้', () => {
    const token = signRunnerToken(secret, 'a@b.c', 60_000, now);
    expect(verifyRunnerToken('other', token, now)).toBeNull();
    const [v, , sub, sig] = token.split('.');
    expect(verifyRunnerToken(secret, `${v}.${now + 9_999_999}.${sub}.${sig}`, now)).toBeNull(); // ยืดเวลา
    expect(verifyRunnerToken(secret, `${v}.${now + 60_000}.${Buffer.from('admin@b.c').toString('base64url')}.${sig}`, now)).toBeNull(); // เปลี่ยนผู้ใช้
    for (const bad of ['', 'x', 'v1.1.2', 'v2.1.2.3', `${token}.extra`, token.slice(0, -2)]) expect(verifyRunnerToken(secret, bad, now), bad).toBeNull();
    expect(verifyRunnerToken(secret, null, now)).toBeNull();
    expect(verifyRunnerToken('', token, now)).toBeNull();
  });

  it('ไม่ยอมออก token โดยไม่มี secret', () => {
    expect(() => signRunnerToken('', 'a')).toThrow('ต้องระบุ secret');
  });
});
