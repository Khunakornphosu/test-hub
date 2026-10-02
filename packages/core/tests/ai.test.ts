import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSteps, redactSnapshot, toStep } from '../src/index.js';

describe('redactSnapshot', () => {
  it('ตัดค่าที่พิมพ์ไว้ทุกช่อง แต่เก็บ placeholder และตัวเลือก', () => {
    const out = redactSnapshot(
      [
        '- textbox "อีเมล":',
        '  - /placeholder: you@example.com',
        '  - text: secret-email@x.com',
        '- textbox "รหัสผ่าน": pass1234',
        '- textbox "a: b" [disabled]: typed',
        '- combobox "บทบาท":',
        '  - option "Tester" [selected]',
        '- button "เข้าสู่ระบบ"',
      ].join('\n')
    );
    for (const secret of ['secret-email', 'pass1234', 'typed']) expect(out).not.toContain(secret);
    expect(out).toContain('/placeholder: you@example.com');
    expect(out).toContain('option "Tester"');
    expect(out).toContain('button "เข้าสู่ระบบ"');
  });

  it('จำกัดความยาวไม่เกิน 20,000 ตัวอักษร', () => {
    expect(redactSnapshot('- text: x\n'.repeat(5000)).length).toBeLessThanOrEqual(20000);
  });
});

describe('toStep', () => {
  it('แปลง target ของโมเดลเป็น locator ตามชนิด', () => {
    expect(toStep({ action: 'click', target: { by: 'role', role: 'button', name: 'OK' } })).toEqual({ action: 'click', locator: { type: 'role', role: 'button', name: 'OK' } });
    expect(toStep({ action: 'click', target: { by: 'label', match: 'อีเมล' } })).toMatchObject({ locator: { type: 'label', value: 'อีเมล' } });
    expect(toStep({ action: 'goto', target: { by: 'none' }, url: 'https://a.test/' })).toEqual({ action: 'goto', value: 'https://a.test/' });
  });

  it('ตีตกเมื่อค่าที่จำเป็นหาย แทนที่จะเดาเอง', () => {
    expect(() => toStep({ action: 'click', target: { by: 'none' } })).toThrow('ไม่ได้ระบุ element');
    expect(() => toStep({ action: 'fill', target: { by: 'label', match: 'x' } })).toThrow('ไม่ได้ระบุข้อความที่จะพิมพ์');
    expect(() => toStep({ action: 'assertText', target: { by: 'css', match: 'body' }, expected: ' ' })).toThrow('ไม่ได้ระบุข้อความที่ต้องตรวจ');
    expect(() => toStep({ action: 'goto', target: { by: 'none' } })).toThrow('ไม่ได้ระบุ URL');
    expect(() => toStep({ action: 'click', target: { by: 'role' } })).toThrow('กรุณาระบุ role');
  });

  it('ช่องรหัสผ่านใช้ตัวแปรลับแทนค่า และเปลี่ยนชื่อเป็นตัวพิมพ์ใหญ่', () => {
    expect(toStep({ action: 'fill', target: { by: 'label', match: 'รหัสผ่าน' }, secret: 'test_password' })).toEqual({
      action: 'fill',
      locator: { type: 'label', value: 'รหัสผ่าน' },
      secret: 'TEST_PASSWORD',
    });
  });
});

describe('generateSteps', () => {
  const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, base: process.env.GEMINI_API_BASE };
  const input = { instruction: 'x', url: 'u', title: 't', snapshot: '- button "ok"', existingSteps: ['เปิด u'] };
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'k';
    process.env.GEMINI_MODEL = 'm';
    delete process.env.GEMINI_API_BASE;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [name, v] of [['GEMINI_API_KEY', saved.key], ['GEMINI_MODEL', saved.model], ['GEMINI_API_BASE', saved.base]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  });

  const text = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

  it('แยก step ที่ใช้ได้ออกจากที่ใช้ไม่ได้ และส่ง schema/คีย์ไปด้วย', async () => {
    const fetchMock = reply(
      text({
        explanation: 'ok',
        steps: [
          { action: 'goto', target: { by: 'none' }, url: 'https://a.test/' },
          { action: 'fill', target: { by: 'label', match: 'อีเมล' } },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateSteps(input);
    expect(result.model).toBe('m');
    expect(result.steps.map((s) => ('step' in s ? 'ok' : s.error))).toEqual(['ok', 'ไม่ได้ระบุข้อความที่จะพิมพ์']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toContain('Instruction: x');
  });

  it('แจ้ง error ภาษาไทยตามสาเหตุ', async () => {
    const cases: [number, unknown, string][] = [
      [429, { error: { message: 'quota' } }, 'เกินโควตาฟรีของ Gemini'],
      [400, { error: { message: 'API key not valid.' } }, 'GEMINI_API_KEY ไม่ถูกต้อง'],
      [403, { error: { message: 'denied' } }, 'ไม่มีสิทธิ์ใช้ Gemini API'],
      [404, { error: { message: 'nope' } }, 'ไม่พบรุ่นที่ระบุ'],
    ];
    for (const [status, body, message] of cases) {
      vi.stubGlobal('fetch', reply(body, status));
      await expect(generateSteps(input), String(status)).rejects.toThrow(message);
    }
    vi.stubGlobal('fetch', reply({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(generateSteps(input)).rejects.toThrow('Gemini ไม่ได้ตอบกลับ (SAFETY)');
    vi.stubGlobal('fetch', reply({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }));
    await expect(generateSteps(input)).rejects.toThrow('อ่านไม่ได้');
  });

  it('รุ่นไม่ว่าง (503) ลองซ้ำแล้วสลับไปรุ่นถัดไป', async () => {
    delete process.env.GEMINI_MODEL;
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        calls.push(url.split('/v1beta/')[1]!);
        if (url.includes('?pageSize')) {
          const models = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.9-flash-preview', 'gemini-3.8-flash-tts'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] }));
          return new Response(JSON.stringify({ models }), { status: 200 });
        }
        if (url.includes('gemini-3.8-flash:')) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
        return new Response(JSON.stringify(text({ explanation: 'ok', steps: [] })), { status: 200 });
      });
      const pending = generateSteps(input);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.model).toBe('gemini-3.8-flash-lite'); // flash ใหม่สุดไม่ว่าง 2 ครั้ง -> สลับไป lite (ไม่เลือก preview/tts)
      expect(calls.filter((c) => c.includes('gemini-3.8-flash:'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ไม่มีคีย์ก็ไม่เรียก API', async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = reply({});
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateSteps(input)).rejects.toThrow('ยังไม่ได้ตั้งค่า GEMINI_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
