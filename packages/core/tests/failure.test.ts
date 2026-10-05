import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyFailure, explainFailure, formatNotice } from '../src/index.js';

describe('classifyFailure', () => {
  it('จัดหมวดจากข้อความ error ที่ระบบสร้าง', () => {
    expect(classifyFailure('หา element ไม่เจอ หรือ element ยังไม่พร้อมใช้งานภายใน 5 วินาที').category).toBe('locator');
    expect(classifyFailure('ข้อความไม่ตรง: คาดว่ามี "a" แต่เจอ "b"').category).toBe('assertion');
    expect(classifyFailure('จำนวนไม่ตรง: คาดว่า 5 แต่เจอ 2').category).toBe('assertion');
    expect(classifyFailure('URL ไม่ตรง: คาดว่า https://a.test/ แต่เป็น https://a.test/login').category).toBe('navigation');
    expect(classifyFailure('page.goto: net::ERR_CONNECTION_REFUSED at https://x.test/').category).toBe('network');
    expect(classifyFailure('หาโดเมน shop.internal ไม่เจอ').category).toBe('network');
    expect(classifyFailure('ไม่อนุญาตให้เปิดที่อยู่ภายในเครือข่าย (10.0.0.5)').category).toBe('blocked');
    expect(classifyFailure('ยังไม่ได้ตั้งค่าตัวแปรลับ PW').category).toBe('data');
    expect(classifyFailure('โค้ดผิดพลาด: x is not defined').category).toBe('script');
    expect(classifyFailure('step 2 ใน "Login": หา element ไม่เจอ').category).toBe('locator');
    expect(classifyFailure('อะไรก็ไม่รู้')).toMatchObject({ category: 'unknown', source: 'rules' });
  });
});

describe('formatNotice', () => {
  it('ใส่สาเหตุที่น่าจะเป็นใต้เทสที่พัง และรายชื่อเทสที่ไม่เสถียร', () => {
    const text = formatNotice({ projectName: 'P', label: 'L', trigger: 'api', total: 3, failed: 1, durationMs: 1000, failures: [{ testName: 'Login', error: 'หา element ไม่เจอ', hint: 'ปุ่มเข้าสู่ระบบเปลี่ยนชื่อเป็น "ลงชื่อเข้าใช้"' }], flaky: ['ตะกร้า'] });
    expect(text).toContain('- Login: หา element ไม่เจอ\n  → ปุ่มเข้าสู่ระบบเปลี่ยนชื่อเป็น "ลงชื่อเข้าใช้"');
    expect(text).toContain('ไม่เสถียร (พังครั้งแรกแล้วรันซ้ำผ่าน): ตะกร้า');
  });
});

describe('explainFailure (Gemini จำลอง)', () => {
  let server: Server;
  let lastBody: { contents: { parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] }[] } | null = null;
  let answer = '';
  const saved = { ...process.env };
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastBody = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-test-flash';
    process.env.GEMINI_API_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
    process.env = saved;
  });

  const input = { testName: 'Login', steps: ['เปิด https://a.test', 'คลิก ปุ่ม "เข้าสู่ระบบ"'], failedIndex: 1, error: 'หา element ไม่เจอ', url: 'https://a.test/', title: 'หน้าแรก', snapshot: '- button "ลงชื่อเข้าใช้"', screenshot: Buffer.from([0xff, 0xd8, 0xff]) };

  it('ส่งขั้นตอน, step ที่พัง, หน้าเว็บ และภาพหน้าจอ แล้วคืนคำอธิบายที่ผ่านการตรวจ', async () => {
    answer = JSON.stringify({ category: 'locator', summary: 'ปุ่มเปลี่ยนชื่อเป็น "ลงชื่อเข้าใช้"', suggestion: 'เลือก element ใหม่ใน Workspace' });
    expect(await explainFailure(input)).toEqual({ category: 'locator', summary: 'ปุ่มเปลี่ยนชื่อเป็น "ลงชื่อเข้าใช้"', suggestion: 'เลือก element ใหม่ใน Workspace', source: 'ai', model: 'gemini-test-flash' });
    const parts = lastBody!.contents[0]!.parts;
    expect(parts[0]!.text).toContain('2. คลิก ปุ่ม "เข้าสู่ระบบ"   <-- FAILED HERE');
    expect(parts[0]!.text).toContain('- button "ลงชื่อเข้าใช้"');
    expect(parts[1]!.inline_data).toEqual({ mime_type: 'image/jpeg', data: '/9j/' });
  });

  it('คำตอบนอกหมวดที่กำหนดถูกปฏิเสธ (ผู้เรียกจะใช้ผลจากกฎแทน) และตัดข้อความยาว', async () => {
    answer = JSON.stringify({ category: 'aliens', summary: 'x', suggestion: 'y' });
    await expect(explainFailure(input)).rejects.toThrow();
    answer = JSON.stringify({ category: 'app', summary: 'ก'.repeat(900), suggestion: 'แจ้งทีม dev' });
    expect((await explainFailure(input)).summary).toHaveLength(400);
  });
});
