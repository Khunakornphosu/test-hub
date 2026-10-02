'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Select } from '@grafana/ui';
import { useProject } from '@/lib/project';

type Overview = { totals: { runs: number; passed: number; failed: number; avgMs: number; healedSteps: number; pendingHeals: number }; series: { t: number; passed: number; failed: number; avgMs: number }[]; slowest: { testId: number; name: string; avgMs: number }[]; timeline: { testId: number; name: string; states: ('p'|'f'|'h')[] }[]; failures: { runId: number; testId: number; testName: string; at: string; stepNumber: number | null; message: string }[] };

export default function Dashboard() {
  const { projects } = useProject();
  const [projectId, setProjectId] = useState('all');
  const [days, setDays] = useState('7');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const to = Date.now(), from = to - Number(days) * 86400_000;
    const query = new URLSearchParams({ from: String(from), to: String(to) });
    if (projectId !== 'all') query.set('projectId', projectId);
    setLoading(true); fetch(`/api/stats?${query}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [projectId, days]);
  const total = data?.totals;
  const rate = total?.runs ? Math.round(total.passed * 100 / total.runs) : 0;
  return <div style={{ padding: 20, display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}><h1>ภาพรวมการทดสอบ</h1><div style={{ display: 'flex', gap: 8 }}><Select aria-label="โปรเจกต์" width={22} options={[{ label: 'ทุกโปรเจกต์', value: 'all' }, ...projects.map((p) => ({ label: p.name, value: String(p.id) }))]} value={projectId} onChange={(v) => setProjectId(v.value ?? 'all')} /><Select aria-label="ช่วงเวลา" width={16} options={[{ label: '24 ชั่วโมง', value: '1' }, { label: '7 วัน', value: '7' }, { label: '30 วัน', value: '30' }]} value={days} onChange={(v) => setDays(v.value ?? '7')} /><Button icon="sync" onClick={() => setDays((v) => v)}>รีเฟรช</Button></div></div>
    {error && <Alert severity="error" title={error} />}{loading && !data ? <span role="status">กำลังโหลดสถิติ…</span> : data && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>{[['อัตราผ่าน', `${rate}%`], ['จำนวนการรัน', total!.runs], ['เวลาเฉลี่ย', `${(total!.avgMs / 1000).toFixed(2)} วินาที`], ['ซ่อม locator', total!.healedSteps], ['รอยืนยัน', total!.pendingHeals]].map(([label, value]) => <div key={String(label)} style={{ border: '1px solid var(--border-weak)', borderRadius: 6, padding: 14 }}><small>{label}</small><h2 style={{ margin: '8px 0 0' }}>{value}</h2></div>)}</div>
      <section style={{ border: '1px solid var(--border-weak)', borderRadius: 6, padding: 14 }}><h2>การรันตามช่วงเวลา</h2><div style={{ display: 'flex', height: 160, alignItems: 'end', gap: 3 }}>{data.series.map((x) => { const max = Math.max(1, ...data.series.map((p) => p.passed + p.failed)); const height = Math.max(2, (x.passed + x.failed) / max * 140); return <div key={x.t} title={`${new Date(x.t).toLocaleString('th-TH')} ผ่าน ${x.passed} ไม่ผ่าน ${x.failed}`} style={{ flex: 1, height, display: 'flex', alignItems: 'end', background: 'var(--green-shade)', borderBottom: `${Math.max(1, x.failed / Math.max(1, x.passed + x.failed) * height)}px solid var(--error-text)` }} />; })}</div><small>สีเขียว = ผ่าน · สีแดง = ไม่ผ่าน</small></section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}><section style={{ border: '1px solid var(--border-weak)', borderRadius: 6, padding: 14 }}><h2>สถานะรายเทส</h2>{data.timeline.map((row) => <div key={row.testId} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, margin: '8px 0' }}><span>{row.name}</span><div style={{ display: 'flex', gap: 2 }}>{row.states.map((v, i) => <span key={i} title={v === 'p' ? 'ผ่าน' : v === 'f' ? 'ไม่ผ่าน' : 'ซ่อมแล้ว'} style={{ flex: 1, height: 12, borderRadius: 2, background: v === 'p' ? '#73bf69' : v === 'f' ? '#f2495c' : '#ff9830' }} />)}</div></div>)}</section>
      <section style={{ border: '1px solid var(--border-weak)', borderRadius: 6, padding: 14 }}><h2>เทสที่ใช้เวลานาน</h2>{data.slowest.map((x) => <div key={x.testId} style={{ display: 'flex', justifyContent: 'space-between', padding: 8 }}><span>{x.name}</span><Badge color="orange" text={`${(x.avgMs / 1000).toFixed(2)} วินาที`} /></div>)}</section></div>
      <section style={{ border: '1px solid var(--border-weak)', borderRadius: 6, padding: 14 }}><h2>รายการไม่ผ่าน</h2>{data.failures.length ? data.failures.map((f) => <div key={f.runId} style={{ padding: 8, borderBottom: '1px solid var(--border-weak)' }}><a href={`/runs?run=${f.runId}`}>{f.testName} · ขั้นที่ {f.stepNumber ?? '—'}</a><p>{f.message}</p></div>) : <p>ไม่มีรายการไม่ผ่านในช่วงเวลานี้</p>}</section>
    </>}</div>;
}
