'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, ClipboardButton, ConfirmModal, EmptyState, Field, IconButton, Input, LoadingPlaceholder, Modal, RadioButtonGroup, Select, Switch, TextArea, useStyles2 } from '@grafana/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import TablePager from './TablePager';
import { api, type BatchInfo, type ChannelConfig, type ChannelType, type EnvironmentInfo, type RunTarget, type ScheduleInfo, type ScheduleInput, type ScheduleTiming } from '@/lib/api';
import { useProject } from '@/lib/project';

const DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const INTERVALS = [15, 30, 60, 120, 180, 360, 720].map((m) => ({ label: m < 60 ? `ทุก ${m} นาที` : `ทุก ${m / 60} ชั่วโมง`, value: m }));
const TRIGGER: Record<BatchInfo['trigger'], string> = { schedule: 'ตั้งเวลา', api: 'CI/API', manual: 'สั่งรัน' };
const CHANNEL_LABEL: Record<ChannelType, string> = { slack: 'Slack', discord: 'Discord', webhook: 'Webhook', line: 'LINE' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const targetKey = (t: RunTarget) => (t.type === 'project' ? 'project' : `${t.type}:${t.id}`);
const parseTarget = (key: string): RunTarget => (key === 'project' ? { type: 'project' } : { type: key.split(':')[0] as 'test' | 'flow', id: Number(key.split(':')[1]) });

function statusBadge(b: BatchInfo) {
  if (b.status === 'queued') return <Badge color="blue" icon="clock-nine" text="รอคิว" />;
  if (b.status === 'running') return <Badge color="orange" icon="sync" text="กำลังรัน" />;
  if (b.status === 'error') return <Badge color="red" icon="exclamation-triangle" text="รันไม่ได้" />;
  return b.failed ? <Badge color="red" icon="times" text="ไม่ผ่าน" /> : <Badge color="green" icon="check" text="ผ่าน" />;
}

export default function AutomationPage() {
  const s = useStyles2(styles);
  const { current, isLoading } = useProject();
  const projectId = current?.id;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [runNowOpen, setRunNowOpen] = useState(false);
  const flash = (text: string) => { setNotice(text); setError(''); };
  const fail = (e: unknown) => { setError((e as Error).message); setNotice(''); };

  if (isLoading) return <div className={s.page}><LoadingPlaceholder text="กำลังโหลด…" /></div>;
  if (!projectId) return <div className={s.page}><EmptyState variant="not-found" message="ยังไม่มีโปรเจกต์" /></div>;
  const ctx = { projectId, flash, fail };

  return <div className={s.page}>
    <header className={s.header}>
      <div><h1>รันอัตโนมัติ</h1><p>โปรเจกต์ <b>{current!.name}</b> · ตั้งเวลารัน แจ้งเตือนผล และสั่งรันจาก CI โดยไม่ต้องเปิด Workspace</p></div>
      <Button icon="play" onClick={() => setRunNowOpen(true)}>รันตอนนี้</Button>
    </header>
    {error && <Alert severity="error" title={error} onRemove={() => setError('')} />}
    {notice && <Alert severity="success" title={notice} onRemove={() => setNotice('')} />}
    <Batches {...ctx} />
    <Schedules {...ctx} />
    <Channels {...ctx} />
    <Environments {...ctx} />
    <CiTokens {...ctx} />
    {runNowOpen && <RunNowModal {...ctx} onClose={() => setRunNowOpen(false)} />}
  </div>;
}

interface Ctx { projectId: number; flash: (text: string) => void; fail: (e: unknown) => void }

function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  const s = useStyles2(styles);
  return <section className={s.section} aria-label={title}>
    <div className={s.sectionHead}><div><h2>{title}</h2><p>{description}</p></div>{action}</div>
    {children}
  </section>;
}

// ---------- รอบการรัน ----------

function Batches({ projectId }: Ctx) {
  const s = useStyles2(styles);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const batches = useQuery({
    queryKey: ['batches', projectId, page, pageSize],
    queryFn: () => api.batches(projectId, page, pageSize),
    // มีรอบที่รอคิว/กำลังรัน: ดึงใหม่ทุก 3 วินาทีจนจบ
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'queued' || b.status === 'running') ? 3000 : false),
  });
  return <Section title="รอบการรันล่าสุด" description="ทุกครั้งที่รันจากตารางเวลา, CI หรือปุ่มรันตอนนี้ ผลแต่ละเทสดูได้ที่หน้าผลการรัน">
    {batches.isLoading ? <LoadingPlaceholder text="กำลังโหลด…" /> : !batches.data?.items.length ? <p className={s.empty}>ยังไม่เคยรันอัตโนมัติ ลองกด "รันตอนนี้" หรือตั้งเวลาด้านล่าง</p> : <>
      <div className={s.tableWrap}><table className={s.table} data-testid="batch-table"><thead><tr><th>สถานะ</th><th>รอบ</th><th>ที่มา</th><th>Environment</th><th>ผล</th><th>เริ่มเมื่อ</th><th /></tr></thead><tbody>
        {batches.data.items.map((b) => <tr key={b.id} data-testid="batch-row">
          <td>{statusBadge(b)}</td>
          <td><b>{b.label}</b>{b.error && <div className={s.errorText}>{b.error}</div>}</td>
          <td className={s.muted}>{TRIGGER[b.trigger]}</td>
          <td className={s.muted}>{b.environmentName ?? '—'}</td>
          <td>{b.status === 'queued' ? '—' : `${b.total - b.failed}/${b.total}`}</td>
          <td className={s.muted}>{when(b.startedAt ?? b.createdAt)}</td>
          <td>{b.total > 0 && <Link className={s.link} href={`/runs?batch=${b.id}&project=all`}>ดูผล</Link>}</td>
        </tr>)}
      </tbody></table></div>
      <TablePager page={page} pageSize={pageSize} total={batches.data.total} label="รอบ" onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>}
  </Section>;
}

function useTargets(projectId: number) {
  const tests = useQuery({ queryKey: ['tests', projectId], queryFn: () => api.tests(projectId) });
  const flows = useQuery({ queryKey: ['flows', projectId], queryFn: () => api.flows(projectId) });
  return useMemo(() => [
    { label: 'ทุกเทสในโปรเจกต์', value: 'project' },
    ...(flows.data ?? []).map((f) => ({ label: `Flow: ${f.name}`, value: `flow:${f.id}` })),
    ...(tests.data ?? []).map((t) => ({ label: `เทส: ${t.name}`, value: `test:${t.id}` })),
  ], [tests.data, flows.data]);
}

function useEnvironmentOptions(projectId: number) {
  const envs = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  return [{ label: 'ไม่ใช้ (URL ตามที่บันทึกไว้)', value: 0 }, ...(envs.data ?? []).map((e) => ({ label: `${e.name} · ${e.baseUrl}`, value: e.id }))];
}

function RunNowModal({ projectId, flash, fail, onClose }: Ctx & { onClose: () => void }) {
  const qc = useQueryClient();
  const targets = useTargets(projectId);
  const envs = useEnvironmentOptions(projectId);
  const [target, setTarget] = useState('project');
  const [envId, setEnvId] = useState(0);
  const run = useMutation({
    mutationFn: () => api.runNow(projectId, parseTarget(target), envId || null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batches', projectId] }); flash('ใส่คิวแล้ว runner จะเริ่มรันภายในไม่กี่วินาที'); onClose(); },
    onError: fail,
  });
  return <Modal title="รันตอนนี้" isOpen onDismiss={onClose}>
    <Field label="รันอะไร"><Select aria-label="รันอะไร" options={targets} value={target} onChange={(v) => setTarget(v.value!)} /></Field>
    <Field label="Environment" description="เปลี่ยนโดเมนของทุก step เปิดหน้าเว็บเป็นของ environment นี้"><Select aria-label="Environment" options={envs} value={envId} onChange={(v) => setEnvId(v.value ?? 0)} /></Field>
    <Modal.ButtonRow><Button variant="secondary" fill="outline" onClick={onClose}>ยกเลิก</Button><Button icon="play" disabled={run.isPending} onClick={() => run.mutate()}>รัน</Button></Modal.ButtonRow>
  </Modal>;
}

// ---------- ตั้งเวลา ----------

const blankSchedule: ScheduleInput = { name: '', target: { type: 'project' }, timing: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] }, environmentId: null, enabled: true };

function Schedules({ projectId, flash, fail }: Ctx) {
  const s = useStyles2(styles);
  const qc = useQueryClient();
  const schedules = useQuery({ queryKey: ['schedules', projectId], queryFn: () => api.schedules(projectId) });
  const envs = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const [editing, setEditing] = useState<{ id: number | null; value: ScheduleInput } | null>(null);
  const [toDelete, setToDelete] = useState<ScheduleInfo | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['schedules', projectId] });
  const toInput = (x: ScheduleInfo): ScheduleInput => ({ name: x.name, target: x.target, timing: x.timing, environmentId: x.environmentId, enabled: x.enabled });
  const toggle = useMutation({ mutationFn: (x: ScheduleInfo) => api.updateSchedule(x.id, { ...toInput(x), enabled: !x.enabled }), onSuccess: refresh, onError: fail });
  const runNow = useMutation({ mutationFn: (id: number) => api.runSchedule(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['batches', projectId] }); flash('ใส่คิวแล้ว runner จะเริ่มรันภายในไม่กี่วินาที'); }, onError: fail });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteSchedule(id), onSuccess: () => { refresh(); setToDelete(null); }, onError: fail });
  const envName = (id: number | null) => envs.data?.find((e) => e.id === id)?.name ?? '—';

  return <Section title="ตั้งเวลา" description="รันเองตามเวลาที่ตั้ง (เวลาประเทศไทย) เครื่องที่รัน runner ต้องเปิดอยู่" action={<Button icon="plus" variant="secondary" onClick={() => setEditing({ id: null, value: blankSchedule })}>ตั้งเวลาใหม่</Button>}>
    {!schedules.data?.length ? <p className={s.empty}>ยังไม่ได้ตั้งเวลา</p> : <div className={s.tableWrap}><table className={s.table}><thead><tr><th>เปิด</th><th>ชื่อ</th><th>รันอะไร</th><th>เวลา</th><th>Environment</th><th>ครั้งถัดไป</th><th /></tr></thead><tbody>
      {schedules.data.map((x) => <tr key={x.id} data-testid="schedule-row">
        <td><Switch aria-label={`เปิดใช้ ${x.name}`} value={x.enabled} onChange={() => toggle.mutate(x)} /></td>
        <td><b>{x.name}</b></td>
        <td className={s.muted}>{x.targetLabel}</td>
        <td>{x.timingLabel}</td>
        <td className={s.muted}>{envName(x.environmentId)}</td>
        <td className={s.muted}>{x.enabled ? when(x.nextRunAt) : 'ปิดอยู่'}</td>
        <td><div className={s.actions}>
          <IconButton name="play" tooltip={`รัน ${x.name} ตอนนี้`} onClick={() => runNow.mutate(x.id)} />
          <IconButton name="pen" tooltip={`แก้ไข ${x.name}`} onClick={() => setEditing({ id: x.id, value: toInput(x) })} />
          <IconButton name="trash-alt" tooltip={`ลบ ${x.name}`} onClick={() => setToDelete(x)} />
        </div></td>
      </tr>)}
    </tbody></table></div>}
    {editing && <ScheduleModal projectId={projectId} initial={editing.value} editingId={editing.id} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); flash('บันทึกตารางเวลาแล้ว'); }} />}
    <ConfirmModal isOpen={!!toDelete} title="ลบตารางเวลา" body={`ลบ "${toDelete?.name}"? ประวัติการรันที่ผ่านมายังอยู่`} confirmText="ลบ" onConfirm={() => { if (toDelete) remove.mutate(toDelete.id); }} onDismiss={() => setToDelete(null)} />
  </Section>;
}

function ScheduleModal({ projectId, initial, editingId, onClose, onSaved }: { projectId: number; initial: ScheduleInput; editingId: number | null; onClose: () => void; onSaved: () => void }) {
  const s = useStyles2(styles);
  const targets = useTargets(projectId);
  const envs = useEnvironmentOptions(projectId);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const timing = value.timing;
  const setTiming = (t: ScheduleTiming) => setValue((v) => ({ ...v, timing: t }));
  const save = useMutation({
    mutationFn: () => (editingId ? api.updateSchedule(editingId, value) : api.createSchedule(projectId, value)).then(() => undefined),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });
  const toggleDay = (d: number) => timing.kind === 'daily' && setTiming({ ...timing, days: timing.days.includes(d) ? timing.days.filter((x) => x !== d) : [...timing.days, d].sort() });
  return <Modal title={editingId ? 'แก้ไขตารางเวลา' : 'ตั้งเวลาใหม่'} isOpen onDismiss={onClose}>
    <form onSubmit={(e) => { e.preventDefault(); if (!value.name.trim()) return setError('กรุณาตั้งชื่อ'); save.mutate(); }}>
      {error && <Alert severity="error" title={error} />}
      <Field label="ชื่อ"><Input autoFocus value={value.name} maxLength={80} placeholder="เช่น ทุกเช้าก่อนเข้างาน" onChange={(e) => setValue({ ...value, name: e.currentTarget.value })} /></Field>
      <Field label="รันอะไร"><Select aria-label="รันอะไร" options={targets} value={targetKey(value.target)} onChange={(v) => setValue({ ...value, target: parseTarget(v.value!) })} /></Field>
      <Field label="ความถี่">
        <RadioButtonGroup aria-label="ความถี่" options={[{ label: 'รายวัน', value: 'daily' }, { label: 'ทุก N นาที', value: 'interval' }]} value={timing.kind} onChange={(k) => setTiming(k === 'daily' ? { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] } : { kind: 'interval', minutes: 60 })} />
      </Field>
      {timing.kind === 'interval'
        ? <Field label="ทุก"><Select aria-label="ทุก" options={INTERVALS} value={timing.minutes} onChange={(v) => setTiming({ kind: 'interval', minutes: v.value! })} /></Field>
        : <>
          <Field label="เวลา (เวลาประเทศไทย)"><Input type="time" aria-label="เวลา" width={16} value={timing.time} onChange={(e) => setTiming({ ...timing, time: e.currentTarget.value })} /></Field>
          <Field label="วัน">
            <div className={s.days}>
              {DAYS.map((d, i) => <Button key={d} type="button" size="sm" variant={timing.days.includes(i) ? 'primary' : 'secondary'} fill={timing.days.includes(i) ? 'solid' : 'outline'} aria-pressed={timing.days.includes(i)} onClick={() => toggleDay(i)}>{d}</Button>)}
              <Button type="button" size="sm" variant="secondary" fill="text" onClick={() => setTiming({ ...timing, days: [1, 2, 3, 4, 5] })}>จ.–ศ.</Button>
              <Button type="button" size="sm" variant="secondary" fill="text" onClick={() => setTiming({ ...timing, days: [0, 1, 2, 3, 4, 5, 6] })}>ทุกวัน</Button>
            </div>
          </Field>
        </>}
      <Field label="Environment"><Select aria-label="Environment" options={envs} value={value.environmentId ?? 0} onChange={(v) => setValue({ ...value, environmentId: v.value || null })} /></Field>
      <Modal.ButtonRow><Button type="button" variant="secondary" fill="outline" onClick={onClose}>ยกเลิก</Button><Button type="submit" disabled={save.isPending}>บันทึก</Button></Modal.ButtonRow>
    </form>
  </Modal>;
}

// ---------- แจ้งเตือน ----------

function Channels({ projectId, flash, fail }: Ctx) {
  const s = useStyles2(styles);
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ['channels', projectId], queryFn: () => api.channels(projectId) });
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['channels', projectId] });
  const update = useMutation({ mutationFn: (v: { id: number; enabled?: boolean; notifyOn?: 'problems' | 'always' }) => api.updateChannel(v.id, v), onSuccess: refresh, onError: fail });
  const test = useMutation({ mutationFn: (id: number) => api.testChannel(id), onSuccess: () => flash('ส่งข้อความทดสอบแล้ว ลองเช็กในช่องทางนั้น'), onError: fail });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteChannel(id), onSuccess: () => { refresh(); setToDelete(null); }, onError: fail });
  return <Section title="แจ้งเตือน" description="ส่งสรุปผลหลังรันอัตโนมัติจบ (ไม่ส่งตอนรันจาก Workspace)" action={<Button icon="plus" variant="secondary" onClick={() => setAdding(true)}>เพิ่มช่องทาง</Button>}>
    {!channels.data?.length ? <p className={s.empty}>ยังไม่มีช่องทางแจ้งเตือน</p> : <div className={s.tableWrap}><table className={s.table}><thead><tr><th>เปิด</th><th>ชื่อ</th><th>ช่องทาง</th><th>ปลายทาง</th><th>แจ้งเมื่อ</th><th /></tr></thead><tbody>
      {channels.data.map((c) => <tr key={c.id} data-testid="channel-row">
        <td><Switch aria-label={`เปิดใช้ ${c.name}`} value={c.enabled} onChange={() => update.mutate({ id: c.id, enabled: !c.enabled })} /></td>
        <td><b>{c.name}</b></td>
        <td>{CHANNEL_LABEL[c.type]}</td>
        <td className={s.muted}><code>{c.destination}</code></td>
        <td><RadioButtonGroup<'problems' | 'always'> size="sm" options={[{ label: 'มีปัญหา', value: 'problems' }, { label: 'ทุกครั้ง', value: 'always' }]} value={c.notifyOn} onChange={(notifyOn) => update.mutate({ id: c.id, notifyOn })} /></td>
        <td><div className={s.actions}>
          <Button size="sm" variant="secondary" icon="message" disabled={test.isPending} onClick={() => test.mutate(c.id)}>ส่งทดสอบ</Button>
          <IconButton name="trash-alt" tooltip={`ลบ ${c.name}`} onClick={() => setToDelete(c.id)} />
        </div></td>
      </tr>)}
    </tbody></table></div>}
    <p className={s.hint}>"มีปัญหา" = แจ้งเมื่อไม่ผ่าน และเมื่อกลับมาผ่านครั้งแรก รอบที่ผ่านต่อเนื่องจะไม่รบกวน</p>
    {adding && <ChannelModal projectId={projectId} onClose={() => setAdding(false)} onSaved={() => { refresh(); setAdding(false); flash('เพิ่มช่องทางแล้ว กด "ส่งทดสอบ" เพื่อเช็กได้'); }} />}
    <ConfirmModal isOpen={toDelete != null} title="ลบช่องทางแจ้งเตือน" body="ลบช่องทางนี้? ต้องใส่ URL/token ใหม่ถ้าจะใช้อีก" confirmText="ลบ" onConfirm={() => { if (toDelete != null) remove.mutate(toDelete); }} onDismiss={() => setToDelete(null)} />
  </Section>;
}

function ChannelModal({ projectId, onClose, onSaved }: { projectId: number; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<ChannelType>('slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [to, setTo] = useState('');
  const [notifyOn, setNotifyOn] = useState<'problems' | 'always'>('problems');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const config: ChannelConfig = type === 'line' ? { type, accessToken: accessToken.trim(), to: to.trim() } : { type, url: url.trim() };
      return api.createChannel(projectId, { name: name.trim() || CHANNEL_LABEL[type], config, notifyOn });
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });
  const urlHint: Record<Exclude<ChannelType, 'line'>, string> = {
    slack: 'Slack → Apps → Incoming Webhooks → Add New Webhook (ขึ้นต้นด้วย https://hooks.slack.com/)',
    discord: 'ตั้งค่าห้อง → Integrations → Webhooks → New Webhook → Copy Webhook URL',
    webhook: 'ระบบจะ POST JSON ไปที่ URL นี้ (https เท่านั้น)',
  };
  return <Modal title="เพิ่มช่องทางแจ้งเตือน" isOpen onDismiss={onClose}>
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {error && <Alert severity="error" title={error} />}
      <Field label="ช่องทาง"><RadioButtonGroup aria-label="ช่องทาง" options={(Object.keys(CHANNEL_LABEL) as ChannelType[]).map((t) => ({ label: CHANNEL_LABEL[t], value: t }))} value={type} onChange={setType} /></Field>
      <Field label="ชื่อ"><Input value={name} maxLength={80} placeholder={`เช่น ${CHANNEL_LABEL[type]} ทีม QA`} onChange={(e) => setName(e.currentTarget.value)} /></Field>
      {type === 'line' ? <>
        <Alert severity="info" title="LINE Notify ปิดบริการแล้ว (มี.ค. 2025) ใช้ LINE Messaging API แทน">สร้าง LINE Official Account และ Messaging API channel ที่ LINE Developers แล้วเชิญบอทเข้ากลุ่ม · แพ็กเกจฟรีส่งได้ 200 ข้อความ/เดือน</Alert>
        <Field label="Channel access token"><TextArea rows={3} value={accessToken} onChange={(e) => setAccessToken(e.currentTarget.value)} /></Field>
        <Field label="ส่งถึง (User ID / Group ID)" description="ขึ้นต้นด้วย U, C หรือ R ตามด้วยตัวอักษร 32 ตัว"><Input value={to} placeholder="Cxxxxxxxx…" onChange={(e) => setTo(e.currentTarget.value)} /></Field>
      </> : <Field label="Webhook URL" description={urlHint[type]}><Input value={url} placeholder="https://…" onChange={(e) => setUrl(e.currentTarget.value)} /></Field>}
      <Field label="แจ้งเมื่อ"><RadioButtonGroup aria-label="แจ้งเมื่อ" options={[{ label: 'มีปัญหา (แนะนำ)', value: 'problems' }, { label: 'ทุกครั้ง', value: 'always' }]} value={notifyOn} onChange={setNotifyOn} /></Field>
      <Modal.ButtonRow><Button type="button" variant="secondary" fill="outline" onClick={onClose}>ยกเลิก</Button><Button type="submit" disabled={save.isPending}>บันทึก</Button></Modal.ButtonRow>
    </form>
  </Modal>;
}

// ---------- environment ----------

function Environments({ projectId, flash, fail }: Ctx) {
  const s = useStyles2(styles);
  const qc = useQueryClient();
  const envs = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const [form, setForm] = useState<{ id: number | null; name: string; baseUrl: string } | null>(null);
  const [toDelete, setToDelete] = useState<EnvironmentInfo | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['environments', projectId] });
  const save = useMutation({
    mutationFn: (f: { id: number | null; name: string; baseUrl: string }) => (f.id ? api.updateEnvironment(f.id, f) : api.createEnvironment(projectId, f)).then(() => undefined),
    onSuccess: () => { refresh(); setForm(null); flash('บันทึก environment แล้ว'); },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteEnvironment(id), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['schedules', projectId] }); setToDelete(null); }, onError: fail });
  return <Section title="Environment" description="ใช้เทสชุดเดียวกับหลายระบบ เช่น dev / staging / production ระบบจะเปลี่ยนโดเมนของทุก step เปิดหน้าเว็บเป็นของ environment ที่เลือก" action={<Button icon="plus" variant="secondary" onClick={() => setForm({ id: null, name: '', baseUrl: '' })}>เพิ่ม environment</Button>}>
    {form && <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
      <Field label="ชื่อ"><Input autoFocus value={form.name} placeholder="เช่น staging" maxLength={40} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} /></Field>
      <Field label="Base URL"><Input value={form.baseUrl} placeholder="https://staging.example.com" onChange={(e) => setForm({ ...form, baseUrl: e.currentTarget.value })} /></Field>
      <div className={s.inlineButtons}><Button type="submit" disabled={save.isPending}>บันทึก</Button><Button type="button" variant="secondary" fill="outline" onClick={() => setForm(null)}>ยกเลิก</Button></div>
    </form>}
    {!envs.data?.length ? (!form && <p className={s.empty}>ยังไม่มี environment เทสจะเปิด URL ตามที่บันทึกไว้</p>) : <div className={s.tableWrap}><table className={s.table}><thead><tr><th>ชื่อ</th><th>Base URL</th><th /></tr></thead><tbody>
      {envs.data.map((e) => <tr key={e.id} data-testid="environment-row"><td><b>{e.name}</b></td><td className={s.muted}><code>{e.baseUrl}</code></td><td><div className={s.actions}>
        <IconButton name="pen" tooltip={`แก้ไข ${e.name}`} onClick={() => setForm({ id: e.id, name: e.name, baseUrl: e.baseUrl })} />
        <IconButton name="trash-alt" tooltip={`ลบ ${e.name}`} onClick={() => setToDelete(e)} />
      </div></td></tr>)}
    </tbody></table></div>}
    <ConfirmModal isOpen={!!toDelete} title="ลบ environment" body={`ลบ "${toDelete?.name}"? ตารางเวลาที่ใช้อยู่จะกลับไปใช้ URL ตามที่บันทึกไว้`} confirmText="ลบ" onConfirm={() => { if (toDelete) remove.mutate(toDelete.id); }} onDismiss={() => setToDelete(null)} />
  </Section>;
}

// ---------- CI ----------

function CiTokens({ projectId, fail }: Ctx) {
  const s = useStyles2(styles);
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ['tokens', projectId], queryFn: () => api.tokens(projectId) });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(location.origin), []);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tokens', projectId] });
  const create = useMutation({ mutationFn: () => api.createToken(projectId, name.trim() || 'CI'), onSuccess: ({ token }) => { setCreated(token); setName(''); refresh(); }, onError: fail });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteToken(id), onSuccess: () => { refresh(); setToDelete(null); }, onError: fail });
  const curl = (token: string) => [
    `curl -s -X POST ${origin}/api/ci/runs \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"environment":"staging"}'`,
    `# ได้ {"id":…, "statusUrl":…} แล้วถามผลที่ statusUrl จนกว่า status จะเป็น done`,
  ].join('\n');
  return <Section title="CI / API" description="สั่งรันหลัง deploy จาก GitHub Actions, GitLab CI หรือ Jenkins ด้วย token ของโปรเจกต์นี้">
    <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <Field label="ชื่อ token"><Input value={name} maxLength={80} placeholder="เช่น GitHub Actions" onChange={(e) => setName(e.currentTarget.value)} /></Field>
      <div className={s.inlineButtons}><Button type="submit" icon="key-skeleton-alt" variant="secondary" disabled={create.isPending}>สร้าง token</Button></div>
    </form>
    {tokens.data?.length ? <div className={s.tableWrap}><table className={s.table}><thead><tr><th>ชื่อ</th><th>Token</th><th>สร้างเมื่อ</th><th>ใช้ล่าสุด</th><th /></tr></thead><tbody>
      {tokens.data.map((t) => <tr key={t.id} data-testid="token-row"><td><b>{t.name}</b></td><td><code>{t.prefix}…</code></td><td className={s.muted}>{when(t.createdAt)}</td><td className={s.muted}>{when(t.lastUsedAt)}</td><td><div className={s.actions}><IconButton name="trash-alt" tooltip={`ลบ token ${t.name}`} onClick={() => setToDelete(t.id)} /></div></td></tr>)}
    </tbody></table></div> : null}
    <details className={s.details}><summary>ตัวอย่างการเรียกจาก CI</summary><pre className={s.code}>{curl('<TOKEN>')}</pre><p className={s.hint}>ระบุ <code>{'"testId"'}</code> หรือ <code>{'"flowId"'}</code> เพื่อรันเฉพาะเทส/Flow · ไม่ใส่ environment = ใช้ URL ตามที่บันทึกไว้ · API นี้ไม่ต้องใช้รหัสผ่านทีม ใช้ token แทน</p></details>
    {created && <Modal title="สร้าง token แล้ว" isOpen onDismiss={() => setCreated(null)}>
      <Alert severity="warning" title="คัดลอกเก็บไว้ตอนนี้ ระบบจะไม่แสดง token นี้อีก" />
      <Field label="Token"><Input readOnly value={created} aria-label="token ที่สร้าง" /></Field>
      <pre className={s.code}>{curl(created)}</pre>
      <Modal.ButtonRow><ClipboardButton icon="copy" variant="secondary" getText={() => created}>คัดลอก token</ClipboardButton><Button onClick={() => setCreated(null)}>เสร็จแล้ว</Button></Modal.ButtonRow>
    </Modal>}
    <ConfirmModal isOpen={toDelete != null} title="ลบ token" body="CI ที่ใช้ token นี้จะสั่งรันไม่ได้ทันที" confirmText="ลบ" onConfirm={() => { if (toDelete != null) remove.mutate(toDelete); }} onDismiss={() => setToDelete(null)} />
  </Section>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ boxSizing: 'border-box', width: '100%', maxWidth: 1280, margin: '0 auto', padding: t.spacing(3), display: 'grid', gap: t.spacing(2.5), '@media (max-width: 760px)': { padding: t.spacing(2) } }),
  header: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: t.spacing(2), flexWrap: 'wrap', h1: { margin: 0 }, p: { margin: `${t.spacing(0.5)} 0 0`, color: t.colors.text.secondary } }),
  section: css({ display: 'grid', gap: t.spacing(1.5), padding: t.spacing(2), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary }),
  sectionHead: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: t.spacing(2), flexWrap: 'wrap', h2: { margin: 0, fontSize: t.typography.h4.fontSize }, p: { margin: `${t.spacing(0.5)} 0 0`, color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize } }),
  empty: css({ margin: 0, padding: t.spacing(2), textAlign: 'center', color: t.colors.text.secondary, border: `1px dashed ${t.colors.border.medium}`, borderRadius: t.shape.radius.default }),
  tableWrap: css({ overflowX: 'auto', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
  table: css({ width: '100%', minWidth: 720, borderCollapse: 'collapse', 'th, td': { textAlign: 'left', padding: t.spacing(1, 1.5), borderBottom: `1px solid ${t.colors.border.weak}`, verticalAlign: 'middle' }, th: { color: t.colors.text.secondary, fontWeight: 500, fontSize: t.typography.bodySmall.fontSize, background: t.colors.background.secondary, whiteSpace: 'nowrap' }, 'tbody tr:last-child td': { borderBottom: 0 }, code: { fontSize: 12 } }),
  muted: css({ color: t.colors.text.secondary }),
  errorText: css({ color: t.colors.error.text, fontSize: t.typography.bodySmall.fontSize }),
  link: css({ color: t.colors.text.link, '&:hover': { textDecoration: 'underline' } }),
  actions: css({ display: 'flex', gap: t.spacing(1), justifyContent: 'flex-end', alignItems: 'center' }),
  hint: css({ margin: 0, color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
  days: css({ display: 'flex', flexWrap: 'wrap', gap: t.spacing(0.5) }),
  inlineForm: css({ display: 'grid', gridTemplateColumns: 'minmax(160px, 240px) minmax(220px, 1fr) auto', gap: t.spacing(1.5), alignItems: 'end', '> div': { marginBottom: 0 }, '@media (max-width: 760px)': { gridTemplateColumns: '1fr' } }),
  inlineButtons: css({ display: 'flex', gap: t.spacing(1), paddingBottom: 2 }),
  details: css({ summary: { cursor: 'pointer', color: t.colors.text.secondary } }),
  code: css({ margin: t.spacing(1, 0), padding: t.spacing(1.5), background: t.colors.background.canvas, border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, fontFamily: t.typography.fontFamilyMonospace, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }),
});

