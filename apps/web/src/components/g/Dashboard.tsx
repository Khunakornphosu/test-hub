'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, RadioButtonGroup, Select, useTheme2 } from '@grafana/ui';
import { useProject } from '@/lib/project';

type Overview = { totals: { runs: number; passed: number; failed: number; avgMs: number; healedSteps: number; pendingHeals: number }; bucketMs: number; series: { t: number; passed: number; failed: number; avgMs: number }[]; slowest: { testId: number; name: string; avgMs: number }[]; timeline: { testId: number; name: string; states: ('p'|'f'|'h')[] }[]; failures: { runId: number; testId: number; testName: string; at: string; stepNumber: number | null; message: string }[] };

export default function Dashboard() {
  const theme = useTheme2();
  const panelStyle = { border: `1px solid ${theme.colors.border.weak}`, background: theme.colors.background.secondary, borderRadius: 8, padding: 16 };
  const mutedText = { color: theme.colors.text.secondary };
  const passColor = theme.visualization.getColorByName('green');
  const failColor = theme.visualization.getColorByName('red');
  const healedColor = theme.visualization.getColorByName('orange');
  const { current } = useProject();
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const projectId = scope === 'all' ? 'all' : current ? String(current.id) : null;
  const [days, setDays] = useState('7');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (projectId == null) return;
    const to = Date.now(), from = to - Number(days) * 86400_000;
    const query = new URLSearchParams({ from: String(from), to: String(to) });
    if (projectId !== 'all') query.set('projectId', projectId);
    setLoading(true); fetch(`/api/stats?${query}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [projectId, days]);
  const total = data?.totals;
  const rate = total?.runs ? Math.round(total.passed * 100 / total.runs) : 0;
  const rangeMs = Number(days) * 86400_000;
  const chartStart = Date.now() - rangeMs;
  const chartSlots = Array.from({ length: 56 }, (_, i) => ({ t: chartStart + i * rangeMs / 56, passed: 0, failed: 0 }));
  for (const point of data?.series ?? []) {
    const index = Math.max(0, Math.min(chartSlots.length - 1, Math.floor((point.t - chartStart) / rangeMs * chartSlots.length)));
    chartSlots[index]!.passed += point.passed;
    chartSlots[index]!.failed += point.failed;
  }
  const chartMax = Math.max(1, ...chartSlots.map((point) => point.passed + point.failed));
  return <div style={{ padding: 24, display: 'grid', gap: 18, maxWidth: 1480, margin: '0 auto' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}><h1>ภาพรวมการทดสอบ</h1><div style={{ display: 'flex', gap: 8 }}><RadioButtonGroup aria-label="ขอบเขต" options={[{ label: 'โปรเจกต์นี้', value: 'current' }, { label: 'ทุกโปรเจกต์', value: 'all' }]} value={scope} onChange={(v) => setScope(v as 'current' | 'all')} /><Select aria-label="ช่วงเวลา" width={16} options={[{ label: '24 ชั่วโมง', value: '1' }, { label: '7 วัน', value: '7' }, { label: '30 วัน', value: '30' }]} value={days} onChange={(v) => setDays(v.value ?? '7')} /><Button icon="sync" onClick={() => setDays((v) => v)}>รีเฟรช</Button></div></div>
    {error && <Alert severity="error" title={error} />}{loading && !data ? <span role="status">กำลังโหลดสถิติ…</span> : data && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>{[['อัตราผ่าน', `${rate}%`], ['จำนวนการรัน', total!.runs], ['เวลาเฉลี่ย', `${(total!.avgMs / 1000).toFixed(2)} วินาที`], ['ซ่อม locator', total!.healedSteps], ['รอยืนยัน', total!.pendingHeals]].map(([label, value]) => <div key={String(label)} style={panelStyle}><small style={mutedText}>{label}</small><h2 style={{ margin: '8px 0 0' }}>{value}</h2></div>)}</div>
      <section style={panelStyle}><h2>การรันตามช่วงเวลา</h2>{total!.runs ? <><div aria-label="กราฟจำนวนการรัน" style={{ display: 'flex', height: 160, alignItems: 'end', gap: 3, margin: '16px 0 10px' }}>{chartSlots.map((point, i) => { const count = point.passed + point.failed; const height = count ? Math.max(4, count / chartMax * 140) : 0; return <div key={i} title={`${new Date(point.t).toLocaleString('th-TH')} ผ่าน ${point.passed} ไม่ผ่าน ${point.failed}`} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'end' }}>{count > 0 && <div style={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'end', overflow: 'hidden', borderRadius: '3px 3px 0 0' }}>{point.passed > 0 && <div style={{ height: `${point.passed / count * 100}%`, minHeight: point.failed ? 1 : 0, background: passColor }} />}{point.failed > 0 && <div style={{ height: `${point.failed / count * 100}%`, minHeight: point.passed ? 1 : 0, background: failColor }} />}</div>}</div>; })}</div><div style={{ display: 'flex', justifyContent: 'space-between', ...mutedText, fontSize: 12, marginBottom: 8 }}><span>{new Date(chartStart).toLocaleDateString('th-TH')}</span><span>วันนี้</span></div><small style={mutedText}>สีเขียว = ผ่าน · สีแดง = ไม่ผ่าน</small></> : <p style={{ ...mutedText, padding: '28px 0' }}>ยังไม่มีการรันในช่วงเวลานี้ ลองขยายช่วงเวลาหรือเริ่มรันเทสเคส</p>}</section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}><section style={panelStyle}><h2>สถานะรายเทส</h2>{data.timeline.length ? data.timeline.map((row) => <div key={row.testId} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 150px) 1fr', gap: 8, margin: '12px 0' }}><span>{row.name}</span><div style={{ display: 'flex', gap: 2 }}>{row.states.map((v, i) => <span key={i} title={v === 'p' ? 'ผ่าน' : v === 'f' ? 'ไม่ผ่าน' : 'ซ่อมแล้ว'} style={{ flex: 1, height: 12, borderRadius: 2, background: v === 'p' ? passColor : v === 'f' ? failColor : healedColor }} />)}</div></div>) : <p>ยังไม่มีข้อมูลสถานะเทส</p>}</section>
      <section style={panelStyle}><h2>เทสที่ใช้เวลานาน</h2>{data.slowest.length ? data.slowest.map((x) => <div key={x.testId} style={{ display: 'flex', justifyContent: 'space-between', padding: 8 }}><span>{x.name}</span><Badge color="orange" text={`${(x.avgMs / 1000).toFixed(2)} วินาที`} /></div>) : <p>ยังไม่มีข้อมูลเวลาเฉลี่ย</p>}</section></div>
      <section style={panelStyle}><h2>รายการไม่ผ่าน</h2>{data.failures.length ? data.failures.map((f) => <div key={f.runId} style={{ padding: 8, borderBottom: `1px solid ${theme.colors.border.weak}` }}><a href={`/runs?run=${f.runId}`}>{f.testName} · ขั้นที่ {f.stepNumber ?? '—'}</a><p>{f.message}</p></div>) : <p>ไม่มีรายการไม่ผ่านในช่วงเวลานี้</p>}</section>
    </>}</div>;
}
