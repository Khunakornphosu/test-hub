'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, RadioButtonGroup, Select, useStyles2 } from '@grafana/ui';
import { useQuery } from '@tanstack/react-query';
import TablePager from '@/components/g/TablePager';
import { api } from '@/lib/api';
import { useProject } from '@/lib/project';

type Recent = { id: number; testId: number; testName: string; projectId: number; startedAt: string; durationMs: number; passed: boolean; hasScreenshot: boolean };
type Detail = Recent & { results: { status: string; action?: string; label?: string; error?: string; durationMs?: number; healed?: unknown[] }[] };
type Status = 'all' | 'passed' | 'failed';
type Scope = 'current' | 'all';
/** scope current = โปรเจกต์ที่เลือกใน sidebar, all = ทุกโปรเจกต์ */
interface Filters { scope: Scope; test: number | null; status: Status; batch: number | null }

const STATUS_OPTIONS: { label: string; value: Status }[] = [{ label: 'ทั้งหมด', value: 'all' }, { label: 'ผ่าน', value: 'passed' }, { label: 'ไม่ผ่าน', value: 'failed' }];
const SCOPE_OPTIONS: { label: string; value: Scope }[] = [{ label: 'โปรเจกต์นี้', value: 'current' }, { label: 'ทุกโปรเจกต์', value: 'all' }];

function readFilters(): Filters {
  const q = new URLSearchParams(location.search);
  const status = q.get('status');
  return {
    scope: q.get('project') === 'all' ? 'all' : 'current',
    batch: Number(q.get('batch')) || null,
    test: Number(q.get('test')) || null,
    status: status === 'passed' || status === 'failed' ? status : 'all',
  };
}

export default function Page() {
  const s = useStyles2(styles);
  const { projects, current } = useProject();
  const [filters, setFilters] = useState<Filters>({ scope: 'current', test: null, status: 'all', batch: null });
  const [ready, setReady] = useState(false);
  const [runs, setRuns] = useState<Recent[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  useEffect(() => { setFilters(readFilters()); setReady(true); }, []);
  const allProjects = filters.scope === 'all';
  const projectId = allProjects ? null : current?.id ?? null;
  // สลับโปรเจกต์จาก sidebar: ตัวกรองเทสเป็นของโปรเจกต์เดิม จึงล้างทิ้ง
  const lastProject = useRef<number | null>(null);
  useEffect(() => {
    const id = current?.id ?? null;
    if (lastProject.current != null && id !== lastProject.current && filters.test != null) update({ test: null });
    lastProject.current = id;
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tests = useQuery({ queryKey: ['tests', projectId], queryFn: () => api.tests(projectId!), enabled: projectId != null });
  const batch = useQuery({ queryKey: ['batch', filters.batch], queryFn: () => api.batch(filters.batch!), enabled: filters.batch != null });
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const waitingForProject = !allProjects && !current;

  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    const q = new URLSearchParams(location.search);
    q.delete('run');
    for (const [key, value] of [['project', next.scope === 'all' ? 'all' : null], ['batch', next.batch], ['test', next.test], ['status', next.status === 'all' ? null : next.status]] as const) {
      if (value == null) q.delete(key);
      else q.set(key, String(value));
    }
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  };

  const load = useCallback(() => {
    if (!ready || waitingForProject) return;
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (projectId != null) q.set('projectId', String(projectId));
    if (filters.test != null) q.set('testId', String(filters.test));
    if (filters.status !== 'all') q.set('status', filters.status);
    if (filters.batch != null) q.set('batchId', String(filters.batch));
    setLoading(true);
    fetch(`/api/runs?${q}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setRuns(d.items); setTotal(d.total); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [ready, waitingForProject, page, pageSize, projectId, filters.test, filters.status, filters.batch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const run = Number(new URLSearchParams(location.search).get('run')); if (run) void openRun(run); }, []);
  const openRun = async (id: number) => { try { const r = await fetch(`/api/runs/${id}`); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDetail(d); } catch (e) { setError((e as Error).message); } };

  const filtered = filters.test != null || filters.status !== 'all';
  const columns = ['สถานะ', ...(allProjects ? ['โปรเจกต์'] : []), 'เทส', 'เวลาเริ่ม', 'ระยะเวลา', 'ภาพหน้าจอ', ''];

  return <div className={s.page}>
    <div className={s.head}><h1>ผลการรัน</h1><Button icon="sync" onClick={() => load()}>โหลดใหม่</Button></div>
    {error && <Alert severity="error" title={error} onRemove={() => setError('')} />}
    {detail && <section className={s.detail}><div className={s.detailHead}><div><h2>{detail.testName} · #{detail.id}</h2><div>{new Date(detail.startedAt).toLocaleString('th-TH')} · {(detail.durationMs / 1000).toFixed(2)} วินาที · <Badge color={detail.passed ? 'green' : 'red'} text={detail.passed ? 'ผ่าน' : 'ไม่ผ่าน'} /></div></div><Button variant="secondary" onClick={() => setDetail(null)}>ปิดรายละเอียด</Button></div>
      <h3>ผลแต่ละขั้นตอน</h3><ol>{detail.results.map((step, i) => <li key={i} style={{ padding: 8, borderBottom: '1px solid var(--border-weak)' }}><Badge color={step.status === 'passed' ? 'green' : step.status === 'failed' ? 'red' : 'blue'} text={step.status === 'passed' ? 'ผ่าน' : step.status === 'failed' ? 'ไม่ผ่าน' : step.status} /> <b>{step.label ?? step.action ?? `ขั้นตอน ${i + 1}`}</b> {step.durationMs != null && <small>{step.durationMs} ms</small>}{step.error && <p style={{ color: 'var(--error-text)' }}>{step.error}</p>}{step.healed?.length ? <p>locator ซ่อมอัตโนมัติ: {step.healed.length}</p> : null}</li>)}</ol>
      {detail.hasScreenshot && <><h3>ภาพหน้าจอเมื่อจบการรัน</h3><img src={`/api/runs/${detail.id}/screenshot`} alt="ภาพหน้าจอผลการรัน" style={{ maxWidth: '100%', border: '1px solid var(--border-weak)' }} /></>}
    </section>}
    <section className={s.section}>
      {batch.data && <Alert severity="info" title={`รอบการรัน #${batch.data.id} · ${batch.data.label}`} onRemove={() => update({ batch: null })}>
        {batch.data.environmentName ? `environment ${batch.data.environmentName} · ` : ''}ผ่าน {batch.data.total - batch.data.failed}/{batch.data.total} · แสดงเฉพาะผลของรอบนี้ (กด × เพื่อดูทั้งหมด)
      </Alert>}
      <div className={s.filters} role="search" aria-label="ตัวกรองผลการรัน">
        <RadioButtonGroup<Scope> aria-label="ขอบเขต" options={SCOPE_OPTIONS} value={filters.scope} onChange={(scope) => update({ scope, test: null })} />
        <Select aria-label="เทส" width={30} isClearable disabled={allProjects} placeholder={allProjects ? 'ทุกเทส (ทุกโปรเจกต์)' : 'ทุกเทส'} options={(tests.data ?? []).map((t) => ({ label: t.name, value: t.id }))} value={filters.test ?? null} onChange={(v) => update({ test: (v?.value as number | undefined) ?? null })} />
        <RadioButtonGroup<Status> aria-label="สถานะ" options={STATUS_OPTIONS} value={filters.status} onChange={(status) => update({ status })} />
        {filtered && <Button variant="secondary" fill="text" icon="times" onClick={() => update({ test: null, status: 'all' })}>ล้างตัวกรอง</Button>}
      </div>
      {loading && !runs.length ? <span role="status">กำลังโหลดผลการรัน…</span> : runs.length ? <>
        <div className={s.tableWrap}><table className={s.table}><thead><tr>{columns.map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>{runs.map((r) => <tr key={r.id}>
          <td><Badge color={r.passed ? 'green' : 'red'} text={r.passed ? 'ผ่าน' : 'ไม่ผ่าน'} /></td>
          {allProjects && <td className={s.muted}>{projectNames.get(r.projectId) ?? `#${r.projectId}`}</td>}
          <td>{r.testName}</td><td>{new Date(r.startedAt).toLocaleString('th-TH')}</td><td>{(r.durationMs / 1000).toFixed(2)} วินาที</td><td>{r.hasScreenshot ? 'มี' : 'ไม่มี'}</td>
          <td><Button size="sm" variant="secondary" onClick={() => void openRun(r.id)}>ดูรายละเอียด</Button></td>
        </tr>)}</tbody></table></div>
        <TablePager page={page} pageSize={pageSize} total={total} label="ครั้ง" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      </> : <div className={s.empty}><p>{filtered ? 'ไม่พบผลการรันตามตัวกรองนี้' : 'ยังไม่มีผลการรัน'}</p>{filtered && <Button variant="secondary" onClick={() => update({ test: null, status: 'all' })}>ล้างตัวกรอง</Button>}</div>}
    </section>
  </div>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ boxSizing: 'border-box', width: '100%', padding: t.spacing(3), display: 'grid', gap: t.spacing(2), maxWidth: 1480, margin: '0 auto', '@media (max-width: 760px)': { padding: t.spacing(2) } }),
  head: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', h1: { margin: 0 } }),
  section: css({ display: 'grid', gap: t.spacing(1.5) }),
  filters: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing(1) }),
  muted: css({ color: t.colors.text.secondary }),
  empty: css({ padding: t.spacing(4), textAlign: 'center', color: t.colors.text.secondary, border: `1px dashed ${t.colors.border.medium}`, borderRadius: t.shape.radius.default, p: { margin: `0 0 ${t.spacing(1.5)}` } }),
  detail: css({ padding: t.spacing(2), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary, h3: { marginTop: t.spacing(2.5) } }),
  detailHead: css({ display: 'flex', justifyContent: 'space-between', gap: t.spacing(2), alignItems: 'flex-start', flexWrap: 'wrap', h2: { marginTop: 0 } }),
  tableWrap: css({ overflowX: 'auto', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
  table: css({ width: '100%', minWidth: 760, borderCollapse: 'collapse', 'th, td': { textAlign: 'left', padding: t.spacing(1.25, 1.5), borderBottom: `1px solid ${t.colors.border.weak}`, borderRight: `1px solid ${t.colors.border.weak}` }, 'th:last-child, td:last-child': { borderRight: 0 }, th: { color: t.colors.text.secondary, fontWeight: 500, fontSize: t.typography.bodySmall.fontSize, background: t.colors.background.secondary, whiteSpace: 'nowrap' }, 'tbody tr:last-child td': { borderBottom: 0 }, 'tbody tr:hover': { background: t.colors.action.hover } }),
});
