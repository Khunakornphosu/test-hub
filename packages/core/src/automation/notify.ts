// ส่งแจ้งเตือนผลการรัน (ฝั่ง server เท่านั้น) ปลายทางทุกแห่งผ่าน UrlGuard เพราะ URL มาจากผู้ใช้
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { UrlGuard } from '../security/url-guard.js';
import type { BatchTrigger, ChannelConfig, NotifyOn } from './types.js';

export interface BatchNotice {
  projectName: string;
  label: string;
  trigger: BatchTrigger;
  environmentName?: string | null;
  total: number;
  failed: number;
  durationMs: number;
  /** ไม่ผ่านรอบก่อนแล้วรอบนี้ผ่าน */
  recovered?: boolean;
  /** ระบบรันไม่ได้ (ไม่ใช่เทสไม่ผ่าน) เช่น ไม่พบเทส */
  error?: string | null;
  failures: { testName: string; error: string }[];
  url?: string | null;
}

const TRIGGER_LABELS: Record<BatchTrigger, string> = { schedule: 'ตั้งเวลา', api: 'CI/API', manual: 'สั่งรัน' };
const MAX_LISTED = 5;

export function shouldNotify(notifyOn: NotifyOn, passed: boolean, previousPassed: boolean | null): boolean {
  return notifyOn === 'always' || !passed || previousPassed === false;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} วินาที` : `${Math.floor(s / 60)} นาที ${s % 60} วินาที`;
}

export function formatNotice(n: BatchNotice): string {
  const passed = !n.error && n.failed === 0;
  const status = n.error ? '[รันไม่ได้]' : !passed ? '[ไม่ผ่าน]' : n.recovered ? '[กลับมาผ่าน]' : '[ผ่าน]';
  const lines = [`${status} ${n.projectName} · ${n.label} (${TRIGGER_LABELS[n.trigger]})`];
  if (n.error) lines.push(n.error);
  else lines.push([`ผ่าน ${n.total - n.failed}/${n.total}`, n.environmentName, duration(n.durationMs)].filter(Boolean).join(' · '));
  for (const f of n.failures.slice(0, MAX_LISTED)) lines.push(`- ${f.testName}: ${f.error}`);
  if (n.failures.length > MAX_LISTED) lines.push(`- และอีก ${n.failures.length - MAX_LISTED} เทส`);
  if (n.url) lines.push(`ดูผล: ${n.url}`);
  return lines.join('\n');
}

/** POST JSON ไปที่ url หลังผ่าน guard แล้วต่อไปที่ IP ที่ตรวจแล้วเท่านั้น (กัน DNS rebinding) */
export async function postJson(guard: UrlGuard, url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const verdict = await guard.check(url);
  if (!verdict.ok) throw new Error(verdict.reason);
  if (!url.startsWith('https://')) throw new Error('ปลายทางต้องเป็น https');
  const pinned = isIP(verdict.address) ? verdict.address : null;
  const lookup: LookupFunction | undefined = pinned
    ? (_host, options, callback) => {
        const family = isIP(pinned);
        if ((options as { all?: boolean }).all) (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned, family }]);
        else callback(null, pinned, family);
      }
    : undefined;
  const payload = JSON.stringify(body);
  await new Promise<void>((resolve, reject) => {
    const req = https.request(url, { method: 'POST', timeout: 10_000, lookup, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { if (text.length < 300) text += chunk; });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`ปลายทางตอบกลับ HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ''}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('ปลายทางไม่ตอบภายใน 10 วินาที')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function sendNotice(guard: UrlGuard, config: ChannelConfig, notice: BatchNotice): Promise<void> {
  const text = formatNotice(notice);
  switch (config.type) {
    case 'slack':
      return postJson(guard, config.url, { text });
    case 'discord':
      return postJson(guard, config.url, { content: text.slice(0, 2000) });
    case 'webhook':
      return postJson(guard, config.url, { event: 'test-studio.batch', text, ...notice });
    case 'line':
      return postJson(guard, 'https://api.line.me/v2/bot/message/push', { to: config.to, messages: [{ type: 'text', text: text.slice(0, 5000) }] }, { Authorization: `Bearer ${config.accessToken}` });
  }
}
