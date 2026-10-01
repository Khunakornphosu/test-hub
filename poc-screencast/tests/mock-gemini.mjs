// Mock ของ Gemini API สำหรับชุดเทส
// - GET  /v1beta/models                      รายชื่อรุ่น
// - POST /v1beta/models/{model}:generateContent  ตอบตามที่ตั้งไว้ด้วย POST /__reply
// - POST /__reply  { status?, body? | result? }   ตั้งคำตอบครั้งถัดไป (result = JSON ที่โมเดลตอบ)
// - GET  /__requests                          request ทั้งหมดที่ได้รับ (ใช้ตรวจสิ่งที่ระบบส่งออกไป)
import http from 'node:http';

const PORT = Number(process.env.PORT) || 4319;
const MODELS = [
  'gemini-3.5-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.9-flash-preview',
  'gemini-3.8-flash-tts',
  'text-embedding-005',
].map((n) => ({
  name: `models/${n}`,
  supportedGenerationMethods: n.startsWith('text-embedding') ? ['embedContent'] : ['generateContent'],
}));

let requests = [];
let nextReply = null;

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      if (req.url === '/__requests') return json(res, 200, requests);
      if (req.url === '/__reply') {
        nextReply = body;
        return json(res, 200, { ok: true });
      }
      requests.push({ method: req.method, url: req.url, key: req.headers['x-goog-api-key'], body });
      if (req.url.startsWith('/v1beta/models?')) return json(res, 200, { models: MODELS });
      if (req.url.includes(':generateContent')) {
        const reply = nextReply ?? { result: { explanation: '', steps: [] } };
        nextReply = null;
        if (reply.result) {
          return json(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(reply.result) }] } }] });
        }
        return json(res, reply.status ?? 200, reply.body ?? {});
      }
      json(res, 404, { error: { message: 'not found' } });
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock gemini on ${PORT}`));
