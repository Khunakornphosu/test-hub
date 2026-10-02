import type { IncomingMessage } from 'node:http';
import { signRunnerToken } from '@test-studio/core';
import { describe, expect, it } from 'vitest';
import { loadConfig, type RunnerConfig } from '../src/config.js';
import { authorizeUpgrade } from '../src/server.js';

const base = { DATABASE_URL: 'postgres://x', SECRET_KEY: 'a-long-enough-key' };

describe('loadConfig', () => {
  it('ใช้ค่าเริ่มต้นที่ปลอดภัย: ฟังเฉพาะเครื่องตัวเองและจำกัด session', () => {
    expect(loadConfig(base)).toMatchObject({ port: 4800, appPort: 4800, host: '127.0.0.1', tokenSecret: '', allowedOrigins: [], maxSessions: 4, runMigrations: false });
  });

  it('แยกค่า ALLOWED_ORIGINS และอ่านค่า boolean/ตัวเลข', () => {
    const c = loadConfig({ ...base, ALLOWED_ORIGINS: 'https://a.app, https://b.app/ ,', MAX_SESSIONS: '9', RUN_MIGRATIONS: 'true', PORT: '5000' });
    expect(loadConfig({ ...base, APP_PORT: '3000' }).appPort).toBe(3000);
    expect(c).toMatchObject({ allowedOrigins: ['https://a.app', 'https://b.app/'], maxSessions: 9, runMigrations: true, port: 5000 });
  });

  it('ไม่ยอมเริ่มเมื่อขาดค่าสำคัญ และบอกเหตุผลเป็นภาษาไทย', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL.*SECRET_KEY|SECRET_KEY.*DATABASE_URL/s);
    expect(() => loadConfig({ ...base, SECRET_KEY: 'short' })).toThrow('อย่างน้อย 8 ตัวอักษร');
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('ค่าตั้งของ runner ไม่ถูกต้อง');
  });

  it('เปิดให้เครื่องอื่นเข้า (HOST=0.0.0.0) โดยไม่มี RUNNER_TOKEN_SECRET ต้องไม่ยอมเริ่ม', () => {
    expect(() => loadConfig({ ...base, HOST: '0.0.0.0' })).toThrow('กรุณาตั้ง RUNNER_TOKEN_SECRET');
    expect(loadConfig({ ...base, HOST: '0.0.0.0', RUNNER_TOKEN_SECRET: 'tok-secret' }).host).toBe('0.0.0.0');
  });
});

describe('authorizeUpgrade', () => {
  const cfg = (over: Partial<RunnerConfig> = {}): RunnerConfig => ({ ...loadConfig(base), port: 4800, ...over });
  const req = (url: string, headers: Record<string, string>) => ({ url, headers }) as unknown as IncomingMessage;
  const local = { host: '127.0.0.1:4800', origin: 'http://127.0.0.1:4800' };

  it('เครื่องตัวเอง: origin เดียวกับ Host ผ่าน', () => {
    expect(authorizeUpgrade(req('/ws', local), cfg(), 0)).toEqual({ ok: true, user: undefined });
  });

  it('ปฏิเสธ path อื่น, ไม่มี Origin, Origin ต่างเว็บ และ Origin ที่เสีย', () => {
    expect(authorizeUpgrade(req('/other', local), cfg(), 0)).toMatchObject({ ok: false, status: 404 });
    expect(authorizeUpgrade(req('/ws', { host: local.host }), cfg(), 0)).toMatchObject({ ok: false, status: 403, reason: 'Missing Origin' });
    expect(authorizeUpgrade(req('/ws', { ...local, origin: 'https://evil.example' }), cfg(), 0)).toMatchObject({ ok: false, status: 403 });
    expect(authorizeUpgrade(req('/ws', { ...local, origin: 'not a url' }), cfg(), 0)).toMatchObject({ ok: false, status: 403 });
  });

  it('ไม่มี token secret: ต้องเป็น Host ของเครื่องตัวเองเท่านั้น (กัน DNS rebinding)', () => {
    const evil = { host: 'evil.example:4800', origin: 'http://evil.example:4800' };
    expect(authorizeUpgrade(req('/ws', evil), cfg(), 0)).toMatchObject({ ok: false, status: 403, reason: 'Invalid Host header' });
  });

  describe('มี RUNNER_TOKEN_SECRET', () => {
    const secret = 'shared-token-secret';
    const config = cfg({ tokenSecret: secret, allowedOrigins: ['https://studio.example.com'] });
    const web = { host: 'runner.internal:4800', origin: 'https://studio.example.com' };

    it('ต้องมี token ที่ถูกต้อง และได้ผู้ใช้จาก token', () => {
      const token = signRunnerToken(secret, 'somchai@example.com');
      expect(authorizeUpgrade(req(`/ws?token=${token}`, web), config, 0)).toEqual({ ok: true, user: 'somchai@example.com' });
      expect(authorizeUpgrade(req('/ws', web), config, 0)).toMatchObject({ ok: false, status: 401 });
      expect(authorizeUpgrade(req('/ws?token=junk', web), config, 0)).toMatchObject({ ok: false, status: 401 });
      expect(authorizeUpgrade(req(`/ws?token=${signRunnerToken('other', 'x')}`, web), config, 0)).toMatchObject({ ok: false, status: 401 });
      expect(authorizeUpgrade(req(`/ws?token=${signRunnerToken(secret, 'x', -1000)}`, web), config, 0)).toMatchObject({ ok: false, status: 401 }); // หมดอายุ
    });

    it('Origin ต้องอยู่ใน ALLOWED_ORIGINS (ไม่ใช่แค่เหมือน Host) แม้มี token ถูกต้อง', () => {
      const token = signRunnerToken(secret, 'a@b.c');
      expect(authorizeUpgrade(req(`/ws?token=${token}`, { ...web, origin: 'https://evil.example' }), config, 0)).toMatchObject({ ok: false, status: 403 });
      expect(authorizeUpgrade(req(`/ws?token=${token}`, { ...web, origin: 'https://studio.example.com.evil.example' }), config, 0)).toMatchObject({ ok: false, status: 403 });
      expect(authorizeUpgrade(req(`/ws?token=${token}`, { ...web, origin: 'HTTPS://Studio.Example.com' }), config, 0)).toMatchObject({ ok: true });
    });
  });

  it('จำนวน session เต็มแล้วปฏิเสธด้วย 503', () => {
    expect(authorizeUpgrade(req('/ws', local), cfg({ maxSessions: 2 }), 1)).toMatchObject({ ok: true });
    expect(authorizeUpgrade(req('/ws', local), cfg({ maxSessions: 2 }), 2)).toMatchObject({ ok: false, status: 503 });
  });
});
