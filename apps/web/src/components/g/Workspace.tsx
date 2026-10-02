'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Field, Icon, IconButton, Input, Modal, PanelChrome, RadioButtonGroup, Select, TextArea, useStyles2 } from '@grafana/ui';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ActionName, Locator, Mode, ServerMessage, Step } from '@test-studio/core/client';
import BrowserView, { type SelectMenu } from './BrowserView';
import { api, type TestSummary } from '@/lib/api';
import { useRunner } from '@/lib/runner';

const labels: Record<Mode, string> = { interact: 'โต้ตอบ', pick: 'เลือก element', assertVisible: 'ตรวจการแสดงผล', assertText: 'ตรวจข้อความ', assertURL: 'ตรวจ URL' };
const modes = (Object.keys(labels) as Mode[]).map((value) => ({ value, label: labels[value] }));
const locatorLabel = (l: Locator | null) => !l ? 'ยังไม่ได้เลือก element' : l.type === 'role' ? `${l.role}${l.name ? `: ${l.name}` : ''}` : `${l.type}: ${l.value}`;

export default function Workspace() {
  const s = useStyles2(styles);
  const [testId, setTestId] = useState<number | null>(null);
  const [testName, setTestName] = useState('');
  const [otherTests, setOtherTests] = useState<TestSummary[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('interact');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [selectMenu, setSelectMenu] = useState<SelectMenu | null>(null);
  const [picked, setPicked] = useState<Locator | null>(null);
  const [locatorResult, setLocatorResult] = useState('');
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [secretValue, setSecretValue] = useState('');
  const [dialog, setDialog] = useState<'ai' | 'export' | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiResult, setAiResult] = useState<Extract<ServerMessage, { type: 'aiResult' }> | null>(null);
  const [exportResult, setExportResult] = useState<Extract<ServerMessage, { type: 'export' }> | null>(null);
  const [frameDraw, setFrameDraw] = useState<(data: string) => void>(() => () => {});
  const registerFrame = useCallback((draw: (data: string) => void) => setFrameDraw(() => draw), []);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });

  useEffect(() => {
    const id = Number(new URLSearchParams(location.search).get('test'));
    if (Number.isInteger(id) && id > 0) setTestId(id);
  }, []);
  useEffect(() => {
    if (!testId) return;
    api.test(testId).then((t) => { setTestName(t.name); setNameDraft(t.name); return api.tests(t.projectId); }).then(setOtherTests).catch((e) => setMessage((e as Error).message));
  }, [testId]);
  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'error' || msg.type === 'aiError') setMessage(msg.message);
    if (msg.type === 'picked') { setPicked(msg.locator); setMessage(`เลือก ${msg.text || locatorLabel(msg.locator)} แล้ว`); }
    if (msg.type === 'selectOpen') setSelectMenu({ x: msg.x, y: msg.y, options: msg.options });
    if (msg.type === 'selectOptions') { setOptions(msg.options ?? []); if (msg.error) setMessage(msg.error); }
    if (msg.type === 'locatorTest') setLocatorResult(msg.error ?? `พบ ${msg.count ?? 0} รายการ`);
    if (msg.type === 'aiResult') setAiResult(msg);
    if (msg.type === 'export') setExportResult(msg);
    if (msg.type === 'ready') setViewport(msg.viewport);
    if (msg.type === 'state') setMode(msg.mode);
  }, []);
  const runner = useRunner({ testId, onMessage, onFrame: frameDraw, onReconnected: () => setMessage('เชื่อมต่อ runner ใหม่แล้ว') });
  const editor = runner.editor;
  const selected = editor?.steps.find((x) => x.id === selectedId) ?? editor?.steps[0];
  useEffect(() => { if (editor?.steps.length && selectedId == null && editor.steps[0]!.id != null) setSelectedId(editor.steps[0]!.id!); }, [editor, selectedId]);
  useEffect(() => { if (runner.url) setAddress(runner.url); }, [runner.url]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const dragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !editor) return;
    const from = editor.steps.findIndex((x) => x.id === Number(active.id));
    const to = editor.steps.findIndex((x) => x.id === Number(over.id));
    if (from < 0 || to < 0) return;
    arrayMove(editor.steps, from, to);
    setSelectedId(Number(active.id));
    runner.send({ type: 'moveStep', id: Number(active.id), to });
  };
  const saveName = async () => { if (!testId || !nameDraft.trim()) return; try { await api.renameTest(testId, nameDraft.trim()); setTestName(nameDraft.trim()); setMessage('บันทึกชื่อเทสแล้ว'); } catch (e) { setMessage((e as Error).message); } };
  const update = (patch: Record<string, unknown>) => {
    if (!selected) return;
    const next = { ...selected, ...patch } as Step;
    runner.send({ type: 'updateStep', id: selected.id!, step: next, ...(secretValue ? { secretValue } : {}) });
    setSecretValue('');
  };
  const setModeAndSend = (next: Mode | undefined) => { const m = next ?? 'interact'; setMode(m); runner.send({ type: 'mode', mode: m }); };
  const onAdd = (action: ActionName) => runner.send({ type: 'insertStep', action });
  const doPick = () => { setPicked(null); setModeAndSend('pick'); };
  const steps = editor?.steps ?? [];
  const health = selected ? editor?.health[selected.id!] : undefined;
  const runDone = runner.run.done;
  const runStep = runDone ? runner.run.steps : null;
  const connectLabel = runner.conn === 'connected' ? 'เชื่อมต่อแล้ว' : runner.conn === 'reconnecting' ? 'กำลังเชื่อมต่อใหม่' : 'กำลังเชื่อมต่อ';
  const actions = runner.ready?.actions;
  const fields = useMemo(() => selected ? Object.entries(actions?.[selected.action]?.fields ?? {}) : [], [selected, actions]);

  return <div className={s.page}>
    <header className={s.toolbar}>
      <IconButton name="arrow-left" tooltip="กลับไปรายการเทส" aria-label="กลับไปรายการเทส" onClick={() => { location.href = '/tests'; }} />
      <Input className={s.titleInput} value={nameDraft} aria-label="ชื่อเทส" onChange={(e) => setNameDraft(e.currentTarget.value)} onBlur={() => { if (nameDraft !== testName) void saveName(); }} onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); }} />
      <Badge color={runner.conn === 'connected' ? 'green' : 'orange'} icon={runner.conn === 'connected' ? 'check-circle' : 'sync'} text={connectLabel} />
      <span className={s.spacer} />
      <RadioButtonGroup<Mode> options={modes} value={mode} onChange={setModeAndSend} size="sm" />
      <Button size="sm" variant={editor?.recording ? 'destructive' : 'secondary'} icon="circle" onClick={() => runner.send({ type: 'record', on: !editor?.recording })}>{editor?.recording ? 'หยุดบันทึก' : 'บันทึก'}</Button>
      <Button size="sm" variant="secondary" icon="ai-sparkle" onClick={() => setDialog('ai')}>AI</Button>
      <Button size="sm" variant="primary" icon="play" disabled={!editor || editor.running} onClick={() => runner.send({ type: 'run' })}>รัน</Button>
      <Button size="sm" variant="secondary" icon="download-alt" onClick={() => { setExportResult(null); setDialog('export'); runner.send({ type: 'export' }); }}>Export</Button>
    </header>
    {message && <Alert severity="info" title={message} className={s.notice} onRemove={() => setMessage('')} />}
    {runner.connectError && <Alert severity="error" title={`เชื่อมต่อ runner ไม่สำเร็จ: ${runner.connectError}`} className={s.notice} />}
    {runDone && <div className={s.runBanner}><Alert severity={runDone.passed ? 'success' : 'error'} title={runDone.passed ? `รันผ่าน ใช้เวลา ${(runDone.ms / 1000).toFixed(1)} วินาที` : 'รันไม่ผ่าน — เปิดผลการรันเพื่อดูข้อผิดพลาดและภาพหน้าจอ'} className={s.notice} /><Button size="sm" onClick={() => { location.href = `/runs?run=${runDone.runId}`; }}>ดูผลการรัน</Button></div>}
    <div className={s.body}>
      <aside className={s.left}><div className={s.panelTitle}>ขั้นตอน <Badge color="blue" text={`${steps.length}`} /></div><div className={s.steps}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={steps.map((x) => x.id!)} strategy={verticalListSortingStrategy}>
          {steps.map((step, i) => <SortableStep key={step.id} step={step} index={i} active={step.id === selected?.id} health={editor?.health[step.id!]} run={runner.run.steps[step.id!]} onClick={() => setSelectedId(step.id!)} onDelete={() => runner.send({ type: 'deleteStep', id: step.id! })} />)}
        </SortableContext></DndContext>
        <div className={s.addRow}><Select aria-label="เลือก action เพื่อเพิ่ม step" options={Object.entries(actions ?? {}).map(([value, spec]) => ({ value, label: spec.label }))} placeholder="เพิ่ม step…" onChange={(v) => v.value && onAdd(v.value as ActionName)} /></div>
      </div></aside>
      <main className={s.center}>
        <div className={s.urlbar}><IconButton name="arrow-left" aria-label="ย้อนกลับ" tooltip="ย้อนกลับ" disabled={!runner.ready} onClick={() => runner.send({ type: 'back' })} /><IconButton name="arrow-right" aria-label="ไปข้างหน้า" tooltip="ไปข้างหน้า" disabled={!runner.ready} onClick={() => runner.send({ type: 'forward' })} /><IconButton name="sync" aria-label="โหลดใหม่" tooltip="โหลดใหม่" disabled={!runner.ready} onClick={() => runner.send({ type: 'reload' })} /><Input value={address} aria-label="URL" className={s.urlInput} onChange={(e) => setAddress(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') runner.send({ type: 'navigate', url: address }); }} /><Button variant="secondary" onClick={() => runner.send({ type: 'navigate', url: address })}>เปิด</Button></div>
        <div className={s.browser}>{runner.ready ? <BrowserView width={viewport.width} height={viewport.height} send={runner.send} mode={mode} registerFrame={registerFrame} selectMenu={selectMenu} onCloseSelect={() => setSelectMenu(null)} disabled={editor?.running} /> : <div className={s.wait} role="status">{runner.conn === 'connecting' ? 'กำลังเปิดเบราว์เซอร์…' : 'กำลังเชื่อมต่อ runner…'}</div>}</div>
      </main>
      <aside className={s.right}><PanelChrome title={selected ? `แก้ไข: ${actions?.[selected.action]?.label ?? selected.action}` : 'เลือก step'} padding="none"><div className={s.editor}>
        {selected ? <>
          <Field label="การกระทำ"><Select options={Object.entries(actions ?? {}).map(([value, spec]) => ({ value, label: spec.label }))} value={selected.action} onChange={(v) => v.value && update({ action: v.value })} /></Field>
          {('locator' in selected) && <Field label="ตัวระบุ element"><div className={s.locator}>{locatorLabel(selected.locator ?? null)}<Button size="sm" variant="secondary" icon="search-plus" onClick={doPick}>เลือกจากหน้าเว็บ</Button><Button size="sm" variant="secondary" onClick={() => selected.locator && runner.send({ type: 'testLocator', locator: selected.locator })}>ทดสอบ</Button>{locatorResult && <small>{locatorResult}</small>}{picked && <Button size="sm" variant="primary" onClick={() => update({ locator: picked })}>ใช้ locator ที่เลือก</Button>}</div></Field>}
          {fields.map(([key, label]) => <Field key={key} label={label} description={actions?.[selected.action]?.hints?.[key]}><Input value={String((selected as unknown as Record<string, unknown>)[key] ?? '')} onChange={(e) => update({ [key]: e.currentTarget.value })} /></Field>)}
          {selected.action === 'fill' && <><Field label="ชื่อตัวแปรลับ (ถ้าต้องการ)"><Input value={String(('secret' in selected && selected.secret) || '')} placeholder="เช่น TEST_EMAIL" onChange={(e) => update({ secret: e.currentTarget.value.toUpperCase() })} /></Field>{'secret' in selected && selected.secret && <Field label={`ค่าใหม่ของ ${selected.secret}`} description="ค่าจะถูกบันทึกเป็น secret และไม่แสดงซ้ำ"><Input type="password" value={secretValue} onChange={(e) => setSecretValue(e.currentTarget.value)} /></Field>}</>}
          {selected.action === 'selectOption' && <><Button size="sm" variant="secondary" onClick={() => 'locator' in selected && selected.locator && runner.send({ type: 'selectOptions', locator: selected.locator })}>โหลดตัวเลือกจากหน้าเว็บ ({options.length})</Button>{options.length > 0 && <Field label="ตัวเลือก"><Select options={options.map((o) => ({ label: o.label || o.value, value: o.value }))} value={selected.value} onChange={(v) => update({ value: v.value, label: v.label })} /></Field>}</>}
          {selected.action === 'useTest' && <Field label="เทสที่ใช้ซ้ำ"><Select options={otherTests.filter((t) => t.id !== testId).map((t) => ({ label: t.name, value: t.id }))} value={selected.testId ?? undefined} placeholder="เลือกเทส" onChange={(v) => update({ testId: v.value ?? null })} /></Field>}
          {health && <div className={s.health}><b>สุขภาพ locator</b><div>ผ่าน {health.runs - health.failed} / {health.runs} · ซ่อม {health.healed} · ล้มเหลว {health.failed}</div></div>}
          {'fallbacks' in selected && selected.fallbacks?.length ? <Alert severity="warning" title="พบ locator ที่ระบบซ่อมให้อัตโนมัติ"><div>ระบบใช้ {locatorLabel(selected.fallbacks[0]!)} แทน locator เดิม</div><Button size="sm" variant="primary" onClick={() => testId && runner.send({ type: 'acceptHeal', testId, stepId: selected.id!, locator: selected.fallbacks![0]! })}>ยอมรับ locator ใหม่</Button></Alert> : null}
          <div className={s.footer}><Button variant="destructive" icon="trash-alt" onClick={() => runner.send({ type: 'deleteStep', id: selected.id! })}>ลบ step</Button><Button variant="primary" icon="save" onClick={() => setMessage('บันทึก step แล้ว')}>บันทึก step</Button></div>
        </> : <p>เพิ่ม step เพื่อเริ่มแก้ไข</p>}
      </div></PanelChrome></aside>
    </div>
    {dialog && <Modal title={dialog === 'ai' ? 'สร้าง step ด้วย AI' : 'ส่งออกเทส'} isOpen onDismiss={() => setDialog(null)}><div className={s.modal}>
      {dialog === 'ai' ? <>{runner.ready?.ai?.enabled ? <><p>อธิบายสิ่งที่ต้องการให้เทสทำ</p><TextArea value={aiText} onChange={(e) => setAiText(e.currentTarget.value)} placeholder="เช่น กรอกอีเมลและรหัสผ่าน แล้วกดเข้าสู่ระบบ" /><Button variant="primary" onClick={() => { setAiResult(null); runner.send({ type: 'aiGenerate', instruction: aiText }); }}>สร้าง step</Button>{aiResult && <><p>{aiResult.explanation}</p>{aiResult.items.map((item, i) => <div key={i}>{item.label} — {item.check === 'verified' ? 'ตรวจสอบผ่าน' : item.error ?? item.check}</div>)}<Button variant="primary" onClick={() => runner.send({ type: 'aiAccept', indexes: aiResult.items.flatMap((x) => x.index == null ? [] : [x.index]) })}>เพิ่ม step ที่เลือก</Button></>}</> : <Alert severity="info" title="ยังไม่ได้ตั้งค่า AI บน runner" />}</> : <>{exportResult ? <><Field label="โค้ด Playwright"><TextArea rows={12} readOnly value={exportResult.code} /></Field><Field label="ข้อมูล JSON"><TextArea rows={8} readOnly value={exportResult.json} /></Field></> : <span role="status">กำลังเตรียมข้อมูลส่งออก…</span>}</>}
    </div></Modal>}
  </div>;
}

function SortableStep({ step, index, active, health, run, onClick, onDelete }: { step: { id?: number; action: string; label: string; parts: { target?: unknown; value?: unknown } }; index: number; active: boolean; health?: { runs: number; healed: number; failed: number }; run?: { status?: string; error?: string }; onClick: () => void; onDelete: () => void }) {
  const s = useStyles2(styles);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: step.id! });
  return <div ref={setNodeRef} data-testid="step-item" style={{ transform: CSS.Transform.toString(transform), transition }} className={`${s.step} ${active ? s.active : ''}`}>
    <button className={s.drag} aria-label="ลากเพื่อเรียง step" {...attributes} {...listeners}><Icon name="draggabledots" /></button><button data-testid="step-main" className={s.stepMain} onClick={onClick}><span className={s.num}>{index + 1}</span><b>{step.label}</b><small>{String(step.parts.target || step.parts.value || '')}</small>{health && <Badge color={health.failed > 0 ? 'orange' : 'green'} text={`${health.runs - health.failed}/${health.runs}`} />}{run?.status && <Badge color={run.status === 'passed' ? 'green' : run.status === 'failed' ? 'red' : 'blue'} text={run.status === 'passed' ? 'ผ่าน' : run.status === 'failed' ? 'ไม่ผ่าน' : 'กำลังรัน'} />}</button><button className={s.delete} aria-label={`ลบ step ${index + 1}`} onClick={onDelete}><Icon name="trash-alt" /></button>
  </div>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ height: '100%', display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr)', minHeight: 0 }), runBanner: css({ display: 'flex', alignItems: 'center', gap: 8 }),
  toolbar: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1), padding: t.spacing(1, 1.5), borderBottom: `1px solid ${t.colors.border.weak}`, flexWrap: 'wrap' }), titleInput: css({ width: 230 }), spacer: css({ flex: 1 }), notice: css({ margin: t.spacing(0.75, 1) }),
  body: css({ display: 'grid', gridTemplateColumns: 'minmax(210px, 260px) minmax(320px, 1fr) minmax(280px, 350px)', gap: t.spacing(1), padding: t.spacing(1), height: 'calc(100vh - 116px)', minHeight: 0 }),
  left: css({ minHeight: 0, display: 'flex', flexDirection: 'column', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary }), panelTitle: css({ display: 'flex', alignItems: 'center', gap: 8, padding: t.spacing(1.5), fontWeight: 600, borderBottom: `1px solid ${t.colors.border.weak}` }), steps: css({ overflow: 'auto', padding: t.spacing(1), display: 'flex', flexDirection: 'column', gap: 5 }),
  step: css({ display: 'grid', gridTemplateColumns: '24px 1fr 24px', border: `1px solid ${t.colors.border.weak}`, borderRadius: 4, background: t.colors.background.primary, '&:hover': { borderColor: t.colors.primary.border } }), active: css({ borderColor: t.colors.primary.border, background: t.colors.action.selected }), drag: css({ border: 0, background: 'transparent', color: t.colors.text.secondary, cursor: 'grab' }), stepMain: css({ textAlign: 'left', border: 0, background: 'transparent', color: t.colors.text.primary, display: 'grid', gridTemplateColumns: '20px 1fr', gap: 4, padding: 7, cursor: 'pointer', small: { gridColumn: '2', color: t.colors.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis' } }), num: css({ color: t.colors.text.secondary }), delete: css({ border: 0, background: 'transparent', color: t.colors.text.secondary, cursor: 'pointer' }), addRow: css({ paddingTop: 6 }),
  center: css({ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: t.spacing(1) }), urlbar: css({ display: 'flex', alignItems: 'center', gap: 5 }), urlInput: css({ flex: 1 }), browser: css({ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', alignContent: 'start', justifyContent: 'center', background: t.colors.background.secondary, border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }), wait: css({ display: 'flex', gap: 10, alignItems: 'center', padding: 30, color: t.colors.text.secondary }), right: css({ minHeight: 0, overflow: 'auto' }), editor: css({ padding: t.spacing(1.5), display: 'flex', flexDirection: 'column', gap: t.spacing(1) }), locator: css({ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: 4, background: t.colors.background.secondary, overflowWrap: 'anywhere' }), health: css({ padding: 10, background: t.colors.background.secondary, borderRadius: 4, fontSize: 12 }), footer: css({ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 12 }), modal: css({ display: 'grid', gap: 12, minWidth: 500, maxWidth: 760 }),
});
