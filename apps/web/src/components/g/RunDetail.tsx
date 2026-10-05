'use client';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Icon, useStyles2 } from '@grafana/ui';
import { useQuery } from '@tanstack/react-query';
import { FAILURE_CATEGORIES, type FailureAnalysis } from '@test-studio/core/client';

export interface RunDetailData {
  id: number;
  testId: number;
  testName?: string;
  startedAt: string;
  durationMs: number;
  passed: boolean;
  flaky: boolean;
  retryError: string | null;
  hasScreenshot: boolean;
  hasTrace: boolean;
  analysis: FailureAnalysis | null;
  results: { status: string; action?: string; label?: string; error?: string; ms?: number; healed?: unknown[] }[];
}

/** URL ของ Trace Viewer ในเว็บเราเอง (trace โหลดจาก API ใน origin เดียวกัน ไม่ส่งออกไปที่อื่น) */
export const traceViewerUrl = (runId: number) => `/trace-viewer/index.html?trace=${encodeURIComponent(`${location.origin}/api/runs/${runId}/trace`)}`;

const fetchRun = async (id: number): Promise<RunDetailData> => {
  const r = await fetch(`/api/runs/${id}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
};

export default function RunDetail({ runId, testName, onClose }: { runId: number; testName?: string; onClose: () => void }) {
  const s = useStyles2(styles);
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => fetchRun(runId),
    // รันจาก Workspace: AI อธิบายสาเหตุเบื้องหลัง จึงถามซ้ำสักพักจนได้คำอธิบาย
    refetchInterval: (q) => {
      const d = q.state.data;
      const young = d && Date.now() - new Date(d.startedAt).getTime() < 2 * 60_000;
      return d && !d.passed && !d.analysis && young ? 3000 : false;
    },
  });
  if (run.error) return <Alert severity="error" title={(run.error as Error).message} onRemove={onClose} />;
  const d = run.data;
  if (!d) return <section className={s.detail}><span role="status">กำลังโหลดผลการรัน…</span></section>;
  const failedIndex = d.results.findIndex((r) => r.status === 'failed');

  return <section className={s.detail} aria-label="รายละเอียดการรัน">
    <div className={s.head}>
      <div>
        <h2>{testName ?? d.testName ?? `เทส #${d.testId}`} · #{d.id}</h2>
        <div className={s.meta}>
          {new Date(d.startedAt).toLocaleString('th-TH')} · {(d.durationMs / 1000).toFixed(2)} วินาที ·{' '}
          <Badge color={d.passed ? 'green' : 'red'} text={d.passed ? 'ผ่าน' : 'ไม่ผ่าน'} />
          {d.flaky && <> <Badge color="orange" icon="exclamation-triangle" text="ไม่เสถียร" /></>}
        </div>
      </div>
      <div className={s.actions}>
        {d.hasTrace && <Button icon="external-link-alt" variant="secondary" onClick={() => window.open(traceViewerUrl(d.id), '_blank', 'noopener')}>เปิด Trace</Button>}
        <Button variant="secondary" onClick={onClose}>ปิดรายละเอียด</Button>
      </div>
    </div>

    {d.flaky && <Alert severity="warning" title="พังครั้งแรก แต่รันซ้ำแล้วผ่าน">
      ครั้งแรกพังเพราะ: {d.retryError ?? 'ไม่ทราบ'} · เทสแบบนี้มักเกิดจากหน้าโหลดช้าหรือข้อมูลที่เปลี่ยนตามเวลา ควรเพิ่มขั้นตอนรอ/ตรวจก่อนทำ step นั้น{d.hasTrace ? ' (Trace เป็นของครั้งที่พัง)' : ''}
    </Alert>}

    {(d.analysis || (!d.passed && run.isFetching)) && <div className={s.analysis} data-testid="failure-analysis">
      <div className={s.analysisHead}>
        <Icon name={d.analysis?.source === 'ai' ? 'ai-sparkle' : 'info-circle'} />
        <b>สาเหตุที่น่าจะเป็น</b>
        {d.analysis && <Badge color={d.analysis.category === 'app' ? 'red' : 'blue'} text={FAILURE_CATEGORIES[d.analysis.category]} />}
        <span className={s.source}>{d.analysis ? (d.analysis.source === 'ai' ? `วิเคราะห์โดย AI${d.analysis.model ? ` (${d.analysis.model})` : ''} จากภาพหน้าจอและหน้าเว็บตอนพัง` : 'จัดหมวดจากข้อความ error') : 'กำลังวิเคราะห์…'}</span>
      </div>
      {d.analysis && <>
        <p>{d.analysis.summary}</p>
        <p className={s.suggestion}><b>ทำต่อ:</b> {d.analysis.suggestion}</p>
      </>}
    </div>}

    <h3>ผลแต่ละขั้นตอน</h3>
    <ol className={s.steps}>{d.results.map((step, i) => <li key={i} className={i === failedIndex ? s.failedStep : undefined}>
      <Badge color={step.status === 'passed' ? 'green' : step.status === 'failed' ? 'red' : 'blue'} text={step.status === 'passed' ? 'ผ่าน' : step.status === 'failed' ? 'ไม่ผ่าน' : step.status === 'skipped' ? 'ข้าม' : step.status} />{' '}
      <b>{step.label ?? step.action ?? `ขั้นตอน ${i + 1}`}</b> {step.ms != null && <small className={s.muted}>{step.ms} ms</small>}
      {step.error && <p className={s.error}>{step.error}</p>}
      {step.healed?.length ? <p className={s.muted}>locator ซ่อมอัตโนมัติ: {step.healed.length}</p> : null}
    </li>)}</ol>
    {d.hasScreenshot && <><h3>ภาพหน้าจอตอนพัง</h3><img src={`/api/runs/${d.id}/screenshot`} alt="ภาพหน้าจอผลการรัน" className={s.shot} /></>}
  </section>;
}

const styles = (t: GrafanaTheme2) => ({
  detail: css({ padding: t.spacing(2), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary, display: 'grid', gap: t.spacing(1.5), h3: { margin: `${t.spacing(1)} 0 0` } }),
  head: css({ display: 'flex', justifyContent: 'space-between', gap: t.spacing(2), alignItems: 'flex-start', flexWrap: 'wrap', h2: { margin: 0 } }),
  meta: css({ marginTop: t.spacing(0.5), color: t.colors.text.secondary }),
  actions: css({ display: 'flex', gap: t.spacing(1) }),
  analysis: css({ padding: t.spacing(1.5, 2), borderRadius: t.shape.radius.default, background: t.colors.background.secondary, borderLeft: `3px solid ${t.colors.primary.main}`, p: { margin: `${t.spacing(0.75)} 0 0` } }),
  analysisHead: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1), flexWrap: 'wrap' }),
  source: css({ color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
  suggestion: css({ color: t.colors.text.primary }),
  steps: css({ margin: 0, paddingLeft: t.spacing(3), li: { padding: t.spacing(1), borderBottom: `1px solid ${t.colors.border.weak}` } }),
  failedStep: css({ background: t.colors.error.transparent, borderRadius: t.shape.radius.default }),
  error: css({ margin: `${t.spacing(0.5)} 0 0`, color: t.colors.error.text }),
  muted: css({ color: t.colors.text.secondary }),
  shot: css({ maxWidth: '100%', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
});
