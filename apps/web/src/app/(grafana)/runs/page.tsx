'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from '@grafana/ui';
import { api } from '@/lib/api';

type Recent = { id: number; testId: number; testName: string; projectId: number; startedAt: string; durationMs: number; passed: boolean; hasScreenshot: boolean };
type Detail = Recent & { results: { status: string; action?: string; label?: string; error?: string; durationMs?: number; healed?: unknown[] }[] };

export default function Page() {
  const [runs, setRuns] = useState<Recent[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); fetch('/api/runs?limit=100').then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setRuns(d); }).catch((e) => setError(e.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); const run = Number(new URLSearchParams(location.search).get('run')); if (run) void openRun(run); }, []);
  const openRun = async (id: number) => { try { const r = await fetch(`/api/runs/${id}`); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDetail(d); } catch (e) { setError((e as Error).message); } };
  return <div style={{ padding: 24, display: 'grid', gap: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h1>ผลการรัน</h1><Button icon="sync" onClick={load}>โหลดใหม่</Button></div>
    {error && <Alert severity="error" title={error} onRemove={() => setError('')} />}
    {detail && <section style={{ padding: 16, border: '1px solid var(--border-weak)', borderRadius: 6 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><div><h2>{detail.testName} · #{detail.id}</h2><div>{new Date(detail.startedAt).toLocaleString('th-TH')} · {(detail.durationMs / 1000).toFixed(2)} วินาที · <Badge color={detail.passed ? 'green' : 'red'} text={detail.passed ? 'ผ่าน' : 'ไม่ผ่าน'} /></div></div><Button variant="secondary" onClick={() => setDetail(null)}>ปิดรายละเอียด</Button></div>
      <h3>ผลแต่ละขั้นตอน</h3><ol>{detail.results.map((step, i) => <li key={i} style={{ padding: 8, borderBottom: '1px solid var(--border-weak)' }}><Badge color={step.status === 'passed' ? 'green' : step.status === 'failed' ? 'red' : 'blue'} text={step.status === 'passed' ? 'ผ่าน' : step.status === 'failed' ? 'ไม่ผ่าน' : step.status} /> <b>{step.label ?? step.action ?? `ขั้นตอน ${i + 1}`}</b> {step.durationMs != null && <small>{step.durationMs} ms</small>}{step.error && <p style={{ color: 'var(--error-text)' }}>{step.error}</p>}{step.healed?.length ? <p>locator ซ่อมอัตโนมัติ: {step.healed.length}</p> : null}</li>)}</ol>
      {detail.hasScreenshot && <><h3>ภาพหน้าจอเมื่อจบการรัน</h3><img src={`/api/runs/${detail.id}/screenshot`} alt="ภาพหน้าจอผลการรัน" style={{ maxWidth: '100%', border: '1px solid var(--border-weak)' }} /></>}
    </section>}
    <section><h2>รายการล่าสุด</h2>{loading ? <span role="status">กำลังโหลดผลการรัน…</span> : runs.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['สถานะ', 'เทส', 'เวลาเริ่ม', 'ระยะเวลา', 'ภาพหน้าจอ', ''].map((x) => <th key={x} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid var(--border-weak)' }}>{x}</th>)}</tr></thead><tbody>{runs.map((r) => <tr key={r.id}><td style={{ padding: 10 }}><Badge color={r.passed ? 'green' : 'red'} text={r.passed ? 'ผ่าน' : 'ไม่ผ่าน'} /></td><td>{r.testName}</td><td>{new Date(r.startedAt).toLocaleString('th-TH')}</td><td>{(r.durationMs / 1000).toFixed(2)} วินาที</td><td>{r.hasScreenshot ? 'มี' : 'ไม่มี'}</td><td><Button size="sm" variant="secondary" onClick={() => void openRun(r.id)}>ดูรายละเอียด</Button></td></tr>)}</tbody></table></div> : <p>ยังไม่มีผลการรัน</p>}</section>
  </div>;
}
