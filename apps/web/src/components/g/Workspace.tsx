'use client';
import { useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Badge, Button, CollapsableSection, Field, Icon, IconButton, Input, PanelChrome, RadioButtonGroup, Select, Tab, TabsBar, ToolbarButton, useStyles2, type IconName } from '@grafana/ui';
import { steps } from '@/lib/data';

type Mode = 'idle' | 'record' | 'pick' | 'assert';
const ICONS: Record<string, IconName> = { open: 'link', type: 'pen', select: 'list-ui-alt', click: 'bolt', text: 'align-left', url: 'link' };
const modeOptions: SelectableValue<Mode>[] = [
  { label: 'บันทึก', value: 'record', icon: 'circle' },
  { label: 'เลือก element', value: 'pick', icon: 'search-plus' },
  { label: 'ตรวจสอบ', value: 'assert', icon: 'check-circle' },
];
const actionOptions: SelectableValue<string>[] = [
  { label: 'คลิก', value: 'click', icon: 'bolt' },
  { label: 'พิมพ์ข้อความ', value: 'fill', icon: 'pen' },
  { label: 'เลือกจาก dropdown', value: 'select', icon: 'list-ui-alt' },
  { label: 'ตรวจข้อความ', value: 'assertText', icon: 'align-left' },
];

const banners: Record<Mode, { severity: 'info' | 'error' | 'warning' | 'success'; title: string }> = {
  idle: { severity: 'info', title: 'พร้อมใช้งาน — กด "รัน" เพื่อทดสอบ หรือ "บันทึก" เพื่อเพิ่ม step ต่อท้าย' },
  record: { severity: 'error', title: 'กำลังบันทึก — ทุกการคลิกและพิมพ์ในหน้าเว็บจะกลายเป็น step' },
  pick: { severity: 'warning', title: 'คลิก element ในหน้าเว็บ เพื่อใช้กับ step ที่กำลังแก้ไข' },
  assert: { severity: 'success', title: 'คลิกข้อความหรือ element ที่ต้องการตรวจ' },
};

export default function Workspace() {
  const s = useStyles2(styles);
  const [mode, setMode] = useState<Mode>('idle');
  const [selected, setSelected] = useState(5);
  const [tab, setTab] = useState<'steps' | 'runs'>('steps');
  const sel = steps.find((x) => x.id === selected)!;
  const banner = banners[mode];

  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <IconButton name="arrow-left" tooltip="กลับไปรายการเทส" aria-label="กลับไปรายการเทส" size="lg" />
        <Input className={s.titleInput} defaultValue="Login ด้วยอีเมล" aria-label="ชื่อเทส" />
        <Badge color="green" icon="check-circle" text="รันล่าสุดผ่าน · 5 นาทีที่แล้ว" />
        <div className={s.spacer} />
        <RadioButtonGroup<Mode> options={modeOptions} value={mode === 'idle' ? undefined : mode} onChange={(v) => setMode(mode === v ? 'idle' : v)} size="md" />
        <ToolbarButton icon="bolt" variant="default">AI</ToolbarButton>
        <Button variant="secondary" icon="save">บันทึก</Button>
        <Button variant="primary" icon="play">รัน</Button>
      </div>

      <div className={s.body}>
        {/* ซ้าย: รายการ step (แบบ Queries/Transformations ของ Grafana) */}
        <div className={s.left}>
          <TabsBar>
            <Tab label="Steps" counter={steps.length} active={tab === 'steps'} onChangeTab={() => setTab('steps')} />
            <Tab label="ผลการรัน" counter={20} active={tab === 'runs'} onChangeTab={() => setTab('runs')} />
          </TabsBar>
          <div className={s.steps}>
            {steps.map((st, i) => (
              <button key={st.id} className={cx(s.step, st.id === selected && s.stepActive)} onClick={() => setSelected(st.id)}>
                <span className={s.num}>{i + 1}</span>
                <span className={cx(s.stepIcon, st.kind === 'assert' && s.stepIconAssert)}><Icon name={ICONS[st.icon] ?? 'bolt'} size="sm" /></span>
                <span className={s.stepText}>
                  <b>{st.verb}</b> <code className={s.chip}>{st.target}</code>
                  {st.value && <span className={s.muted}> {st.value}</span>}
                  {st.healed && <span className={s.healed}><Icon name="sync" size="xs" /> ซ่อมอัตโนมัติ — รอยืนยัน</span>}
                </span>
              </button>
            ))}
            <button className={s.add}><Icon name="plus" /> เพิ่ม step หรือใช้เทสอื่นซ้ำ (block)</button>
          </div>
        </div>

        {/* กลาง: หน้าเว็บ */}
        <div className={s.center}>
          <div className={s.noGrow}>
            <Alert severity={banner.severity} title={banner.title} className={s.alert} topSpacing={0} bottomSpacing={0} onRemove={mode === 'idle' ? undefined : () => setMode('idle')} />
          </div>
          <div className={s.urlbar}>
            <IconButton name="arrow-left" aria-label="ย้อนกลับ" tooltip="ย้อนกลับ" />
            <IconButton name="arrow-right" aria-label="ไปข้างหน้า" tooltip="ไปข้างหน้า" />
            <IconButton name="sync" aria-label="โหลดใหม่" tooltip="โหลดใหม่" />
            <Input defaultValue="https://shop.example.com/login" aria-label="URL" className={s.urlInput} />
            <Button variant="secondary">เปิด</Button>
          </div>
          <div className={cx(s.browser, mode !== 'idle' && s[`ring_${mode}` as 'ring_record'])}>
            <MockPage highlightButton={mode === 'pick'} />
          </div>
        </div>

        {/* ขวา: ตัวเลือกของ step (แบบ Options pane) */}
        <div className={s.right}>
          <PanelChrome title={`แก้ไข step ${steps.findIndex((x) => x.id === selected) + 1}`} padding="none">
            <div className={s.options}>
              <CollapsableSection label="การกระทำ" isOpen>
                <Field label="ทำอะไร"><Select options={actionOptions} value={sel.verb === 'คลิก' ? 'click' : sel.verb === 'พิมพ์' ? 'fill' : sel.verb === 'เลือก' ? 'select' : 'assertText'} onChange={() => {}} /></Field>
                <Field label="กับ element ไหน" description="คลิก “เลือกใหม่จากหน้าเว็บ” แล้วชี้ที่ element ที่ต้องการ">
                  <div className={s.target}>
                    <code className={s.chip}>{sel.target}</code>
                    <span className={s.ok}><Icon name="check-circle" size="sm" /> พบ 1 ตัวในหน้านี้ (ไฮไลต์สีเหลือง)</span>
                    <div className={s.row}>
                      <Button size="sm" variant="secondary" icon="search-plus" onClick={() => setMode('pick')}>เลือกใหม่จากหน้าเว็บ</Button>
                      <Button size="sm" variant="secondary">ทดสอบ</Button>
                    </div>
                  </div>
                </Field>
                {sel.value && <Field label="ค่า"><Input defaultValue={sel.value.replace(/"/g, '')} /></Field>}
              </CollapsableSection>

              {sel.healed && (
                <CollapsableSection label="ซ่อมอัตโนมัติ" isOpen>
                  <Alert severity="warning" title="ซ่อมอัตโนมัติในการรันล่าสุด" topSpacing={0}>
                    locator เดิมหาไม่เจอ ระบบใช้ <b>CSS: #f &gt; button</b> แทน
                    <div className={s.row} style={{ marginTop: 8 }}><Button size="sm" variant="primary" fill="outline">ใช้ locator ใหม่</Button></div>
                  </Alert>
                </CollapsableSection>
              )}

              <CollapsableSection label="ขั้นสูง: แก้ locator เอง" isOpen={false}>
                <Field label="ประเภท"><Select options={[{ label: 'Role', value: 'role' }, { label: 'Label', value: 'label' }, { label: 'CSS', value: 'css' }]} value="role" onChange={() => {}} /></Field>
                <Field label="ค่า"><Input placeholder="button / เข้าสู่ระบบ" /></Field>
              </CollapsableSection>

              <CollapsableSection label="ประวัติ step นี้" isOpen>
                <div className={s.history}>{'pppppppppppphpppppppp'.split('').map((c, i) => <i key={i} className={c === 'p' ? s.hOk : s.hWarn} />)}</div>
                <div className={s.muted}>20 การรันล่าสุด · ซ่อมอัตโนมัติ 1 ครั้ง</div>
              </CollapsableSection>
              <div className={s.footer}>
                <Button variant="secondary">ยกเลิก</Button>
                <Button variant="primary">บันทึก step</Button>
              </div>
            </div>
          </PanelChrome>
        </div>
      </div>
    </div>
  );
}

// หน้าเว็บจำลองแทน screencast จริง (ใช้สีของตัวเอง เพราะเป็นเว็บของคนอื่นที่กำลังทดสอบ)
function MockPage({ highlightButton }: { highlightButton: boolean }) {
  const field: React.CSSProperties = { border: '1px solid #ccc', borderRadius: 4, padding: '8px 10px', fontSize: 14, color: '#1f2328', background: '#fff' };
  return (
    <div style={{ background: '#f3f4f8', color: '#1f2328', height: '100%', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: 340, boxShadow: '0 4px 16px rgba(0,0,0,.1)', display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>เข้าสู่ระบบ</div>
        <div style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13 }}>อีเมล</span><div style={field}>somchai@test.com</div></div>
        <div style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13 }}>รหัสผ่าน</span><div style={field}>••••••••</div></div>
        <div style={{ background: '#3557e0', color: '#fff', textAlign: 'center', padding: '9px 0', borderRadius: 4, fontSize: 14, fontWeight: 500, ...(highlightButton ? { outline: '2px solid #ff9830', outlineOffset: 2, boxShadow: '0 0 0 6px rgba(255,152,48,0.25)' } : {}) }}>เข้าสู่ระบบ</div>
      </div>
    </div>
  );
}

const styles = (theme: GrafanaTheme2) => {
  const ring = (c: string) => css({ outline: `2px solid ${c}`, outlineOffset: 1 });
  return {
    page: css({ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: 0 }),
    toolbar: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1.5), padding: theme.spacing(1, 2), background: theme.colors.background.primary, borderBottom: `1px solid ${theme.colors.border.weak}` }),
    titleInput: css({ width: 240, input: { fontWeight: theme.typography.fontWeightMedium } }),
    spacer: css({ flex: 1 }),
    body: css({ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr) 360px', gap: theme.spacing(1), padding: theme.spacing(1), minHeight: 0, height: 'calc(100vh - 40px - 57px)' }),
    left: css({ display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.colors.background.primary, border: `1px solid ${theme.colors.border.weak}`, borderRadius: theme.shape.radius.default }),
    steps: css({ flex: 1, overflow: 'auto', padding: theme.spacing(1), display: 'flex', flexDirection: 'column', gap: 2 }),
    step: css({ all: 'unset', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: '18px 24px 1fr', gap: theme.spacing(1), alignItems: 'start', padding: theme.spacing(1), borderRadius: theme.shape.radius.default, border: '1px solid transparent', cursor: 'pointer', fontSize: theme.typography.bodySmall.fontSize, lineHeight: 1.5, '&:hover': { background: theme.colors.action.hover } }),
    stepActive: css({ background: theme.colors.action.selected, borderColor: theme.colors.primary.border }),
    num: css({ color: theme.colors.text.secondary, textAlign: 'right', paddingTop: 2 }),
    stepIcon: css({ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', background: theme.colors.primary.transparent, color: theme.colors.primary.text }),
    stepIconAssert: css({ background: theme.colors.success.transparent, color: theme.colors.success.text }),
    stepText: css({ paddingTop: 2, minWidth: 0, overflowWrap: 'anywhere' }),
    chip: css({ background: theme.colors.background.secondary, border: `1px solid ${theme.colors.border.weak}`, borderRadius: 4, padding: '0 6px', fontFamily: 'inherit', fontSize: 'inherit', color: theme.colors.text.primary }),
    muted: css({ color: theme.colors.text.secondary }),
    healed: css({ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: theme.spacing(1), padding: '0 6px', borderRadius: 10, fontSize: 11, color: theme.colors.warning.text, border: `1px solid ${theme.colors.warning.border}` }),
    add: css({ all: 'unset', boxSizing: 'border-box', textAlign: 'center', marginTop: theme.spacing(0.5), padding: theme.spacing(1), border: `1px dashed ${theme.colors.border.medium}`, borderRadius: theme.shape.radius.default, color: theme.colors.text.secondary, cursor: 'pointer', '&:hover': { color: theme.colors.primary.text, borderColor: theme.colors.primary.border } }),
    center: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), minWidth: 0, minHeight: 0 }),
    noGrow: css({ flex: 'none' }),
    alert: css({ margin: 0 }),
    urlbar: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), flex: 'none' }),
    urlInput: css({ flex: 1 }),
    browser: css({ flex: 1, minHeight: 0, borderRadius: theme.shape.radius.default, overflow: 'hidden', border: `1px solid ${theme.colors.border.weak}` }),
    ring_record: ring(theme.colors.error.main),
    ring_pick: ring(theme.colors.warning.main),
    ring_assert: ring(theme.colors.success.main),
    right: css({ minHeight: 0, overflow: 'auto' }),
    options: css({ padding: theme.spacing(0, 1.5, 1.5) }),
    target: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), padding: theme.spacing(1), background: theme.colors.background.secondary, borderRadius: theme.shape.radius.default }),
    ok: css({ display: 'inline-flex', alignItems: 'center', gap: 4, color: theme.colors.success.text, fontSize: theme.typography.bodySmall.fontSize }),
    row: css({ display: 'flex', gap: theme.spacing(1) }),
    history: css({ display: 'flex', gap: 2, height: 18, marginBottom: theme.spacing(0.5), i: { flex: 1, borderRadius: 2 } }),
    hOk: css({ background: theme.visualization.getColorByName('green'), opacity: 0.85 }),
    hWarn: css({ background: theme.visualization.getColorByName('orange') }),
    footer: css({ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing(1), paddingTop: theme.spacing(1) }),
  };
};
