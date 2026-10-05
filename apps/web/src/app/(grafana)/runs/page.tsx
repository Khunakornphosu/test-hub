'use client';
import { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, useStyles2 } from '@grafana/ui';
import TablePager from '@/components/g/TablePager';

type Recent = { id: number; testId: number; testName: string; projectId: number; startedAt: string; durationMs: number; passed: boolean; hasScreenshot: boolean };
type Detail = Recent & { results: { status: string; action?: string; label?: string; error?: string; durationMs?: number; healed?: unknown[] }[] };

export default function Page() {
  const s = useStyles2(styles);
  const [runs, setRuns] = useState<Recent[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const load = useCallback((p = page, size = pageSize) => {
    setLoading(true);
    fetch(`/api/runs?page=${p}&pageSize=${size}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setRuns(d.items); setTotal(d.total); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [page, pageSize]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const run = Number(new URLSearchParams(location.search).get('run')); if (run) void openRun(run); }, []);
  const openRun = async (id: number) => { try { const r = await fetch(`/api/runs/${id}`); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDetail(d); } catch (e) { setError((e as Error).message); } };
  return <div className={s.page}>
    <div className={s.head}><h1>ผลการรัน</h1><Button icon="sync" onClick={() => load()}>โหลดใหม่</Button></div>
    {error && <Alert severity="error" title={error} onRemove={() => setError('')} />}
    {detail && <section className={s.detail}><div className={s.detailHead}><div><h2>{detail.testName} · #{detail.id}</h2><div>{new Date(detail.startedAt).toLocaleString('th-TH')} · {(detail.durationMs / 1000).toFixed(2)} วินาที · <Badge color={detail.passed ? 'green' : 'red'} text={detail.passed ? 'ผ่าน' : 'ไม่ผ่าน'} /></div></div><Button variant="secondary" onClick={() => setDetail(null)}>ปิดรายละเอียด</Button></div>
      <h3>ผลแต่ละขั้นตอน</h3><ol>{detail.results.map((step, i) => <li key={i} style={{ padding: 8, borderBottom: '1px solid var(--border-weak)' }}><Badge color={step.status === 'passed' ? 'green' : step.status === 'failed' ? 'red' : 'blue'} text={step.status === 'passed' ? 'ผ่าน' : step.status === 'failed' ? 'ไม่ผ่าน' : step.status} /> <b>{step.label ?? step.action ?? `ขั้นตอน ${i + 1}`}</b> {step.durationMs != null && <small>{step.durationMs} ms</small>}{step.error && <p style={{ color: 'var(--error-text)' }}>{step.error}</p>}{step.healed?.length ? <p>locator ซ่อมอัตโนมัติ: {step.healed.length}</p> : null}</li>)}</ol>
      {detail.hasScreenshot && <><h3>ภาพหน้าจอเมื่อจบการรัน</h3><img src={`/api/runs/${detail.id}/screenshot`} alt="ภาพหน้าจอผลการรัน" style={{ maxWidth: '100%', border: '1px solid var(--border-weak)' }} /></>}
    </section>}
    <section className={s.section}><h2>รายการล่าสุด</h2>{loading && !runs.length ? <span role="status">กำลังโหลดผลการรัน…</span> : runs.length ? <> <div className={s.tableWrap}><table className={s.table}><thead><tr>{['สถานะ', 'เทส', 'เวลาเริ่ม', 'ระยะเวลา', 'ภาพหน้าจอ', ''].map((x) => <th key={x}>{x}</th>)}</tr></thead><tbody>{runs.map((r) => <tr key={r.id}><td><Badge color={r.passed ? 'green' : 'red'} text={r.passed ? 'ผ่าน' : 'ไม่ผ่าน'} /></td><td>{r.testName}</td><td>{new Date(r.startedAt).toLocaleString('th-TH')}</td><td>{(r.durationMs / 1000).toFixed(2)} วินาที</td><td>{r.hasScreenshot ? 'มี' : 'ไม่มี'}</td><td><Button size="sm" variant="secondary" onClick={() => void openRun(r.id)}>ดูรายละเอียด</Button></td></tr>)}</tbody></table></div><TablePager page={page} pageSize={pageSize} total={total} label="ครั้ง" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /></> : <p>ยังไม่มีผลการรัน</p>}</section>
  </div>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ boxSizing: 'border-box', width: '100%', padding: t.spacing(3), display: 'grid', gap: t.spacing(2), maxWidth: 1480, margin: '0 auto', '@media (max-width: 760px)': { padding: t.spacing(2) } }),
  head: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', h1: { margin: 0 } }),
  section: css({ h2: { marginTop: 0 } }),
  detail: css({ padding: t.spacing(2), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary, h3: { marginTop: t.spacing(2.5) } }),
  detailHead: css({ display: 'flex', justifyContent: 'space-between', gap: t.spacing(2), alignItems: 'flex-start', flexWrap: 'wrap', h2: { marginTop: 0 } }),
  tableWrap: css({ overflowX: 'auto', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
  table: css({ width: '100%', minWidth: 760, borderCollapse: 'collapse', 'th, td': { textAlign: 'left', padding: t.spacing(1.25, 1.5), borderBottom: `1px solid ${t.colors.border.weak}`, borderRight: `1px solid ${t.colors.border.weak}` }, 'th:last-child, td:last-child': { borderRight: 0 }, th: { color: t.colors.text.secondary, fontWeight: 500, fontSize: t.typography.bodySmall.fontSize, background: t.colors.background.secondary, whiteSpace: 'nowrap' }, 'tbody tr:last-child td': { borderBottom: 0 }, 'tbody tr:hover': { background: t.colors.action.hover } }),
});
