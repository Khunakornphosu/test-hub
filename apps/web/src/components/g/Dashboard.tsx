'use client';
import { useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, getDefaultTimeRange, type GrafanaTheme2, type SelectableValue, type TimeRange } from '@grafana/data';
import { Button, Dropdown, Icon, IconButton, InlineField, InlineFieldRow, Menu, RefreshPicker, Select, TagList, TimeRangePicker, ToolbarButton, useStyles2 } from '@grafana/ui';
import { GridLayout, useContainerWidth, type Layout } from 'react-grid-layout';
import { FailuresPanel, RatePanel, RunsPanel, SlowestPanel, StatPanel, StatePanel } from './panels';

// ตำแหน่งเริ่มต้นของ panel (กริด 24 คอลัมน์ เหมือน Grafana) ลาก/ย่อขยายได้
const initial: Layout = [
  { i: 'pass', x: 0, y: 0, w: 6, h: 4 },
  { i: 'runs', x: 6, y: 0, w: 6, h: 4 },
  { i: 'dur', x: 12, y: 0, w: 6, h: 4 },
  { i: 'heal', x: 18, y: 0, w: 6, h: 4 },
  { i: 'series', x: 0, y: 4, w: 16, h: 9 },
  { i: 'rate', x: 16, y: 4, w: 8, h: 9 },
  { i: 'state', x: 0, y: 13, w: 16, h: 8 },
  { i: 'slow', x: 16, y: 13, w: 8, h: 8 },
  { i: 'fail', x: 0, y: 21, w: 24, h: 9 },
];

const projects: SelectableValue<string>[] = [{ label: 'ทั้งหมด', value: 'all' }, { label: 'Shop', value: 'shop' }, { label: 'Admin', value: 'admin' }];
const browsers: SelectableValue<string>[] = [{ label: 'Chromium', value: 'chromium' }, { label: 'Firefox', value: 'firefox' }, { label: 'WebKit', value: 'webkit' }];

export default function Dashboard() {
  const s = useStyles2(styles);
  const [range, setRange] = useState<TimeRange>(() => {
    const r = getDefaultTimeRange();
    const to = dateTime();
    return { from: dateTime(to).subtract(7, 'd'), to, raw: { from: 'now-7d', to: 'now' } } as TimeRange & typeof r;
  });
  const [project, setProject] = useState<string>('all');
  const [browser, setBrowser] = useState<string>('chromium');
  const [refresh, setRefresh] = useState('30s');
  const [layout, setLayout] = useState<Layout>(initial);
  const { width, containerRef, mounted } = useContainerWidth();

  const addMenu = (
    <Menu>
      <Menu.Item label="Visualization" icon="graph-bar" />
      <Menu.Item label="Row" icon="bars" />
      <Menu.Item label="Import จากเทสเคส" icon="import" />
    </Menu>
  );

  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <div className={s.title}>
          <h1>ภาพรวมการทดสอบ</h1>
          <IconButton name="star" tooltip="ทำเครื่องหมายเป็นรายการโปรด" aria-label="รายการโปรด" />
          <TagList tags={['production', 'auto-refresh']} className={s.tags} />
        </div>
        <div className={s.actions}>
          <Dropdown overlay={addMenu}>
            <Button variant="secondary" icon="plus" size="sm">เพิ่ม <Icon name="angle-down" /></Button>
          </Dropdown>
          <ToolbarButton icon="cog" iconOnly tooltip="ตั้งค่าแดชบอร์ด" aria-label="ตั้งค่าแดชบอร์ด" />
          <ToolbarButton icon="share-alt" iconOnly tooltip="แชร์" aria-label="แชร์" />
          <TimeRangePicker value={range} onChange={setRange} onChangeTimeZone={() => {}} onMoveBackward={() => {}} onMoveForward={() => {}} onZoom={() => {}} timeZone="browser" />
          <RefreshPicker onRefresh={() => {}} onIntervalChanged={setRefresh} value={refresh} intervals={['10s', '30s', '1m', '5m']} />
          <ToolbarButton icon="monitor" iconOnly tooltip="โหมดแสดงเต็มจอ" aria-label="โหมดแสดงเต็มจอ" />
        </div>
      </div>

      <div className={s.vars}>
        <InlineFieldRow>
          <InlineField label="โปรเจกต์"><Select width={18} options={projects} value={project} onChange={(v) => setProject(v.value ?? 'all')} /></InlineField>
          <InlineField label="เบราว์เซอร์"><Select width={18} options={browsers} value={browser} onChange={(v) => setBrowser(v.value ?? 'chromium')} /></InlineField>
        </InlineFieldRow>
      </div>

      <div ref={containerRef} className={s.grid}>
        {mounted && (
          <GridLayout
            layout={layout}
            width={width}
            gridConfig={{ cols: 24, rowHeight: 30, margin: [8, 8], containerPadding: [0, 0] }}
            dragConfig={{ handle: '.panel-drag-handle' }}
            onLayoutChange={(l) => setLayout(l as Layout)}
          >
            <div key="pass"><StatPanel title="อัตราผ่าน" k="passRate" /></div>
            <div key="runs"><StatPanel title="จำนวนการรันวันนี้" k="runs" /></div>
            <div key="dur"><StatPanel title="เวลาเฉลี่ยต่อการรัน" k="duration" /></div>
            <div key="heal"><StatPanel title="locator ที่ซ่อมอัตโนมัติ" k="healed" /></div>
            <div key="series"><RunsPanel timeRange={range} /></div>
            <div key="rate"><RatePanel timeRange={range} /></div>
            <div key="state"><StatePanel /></div>
            <div key="slow"><SlowestPanel /></div>
            <div key="fail"><FailuresPanel /></div>
          </GridLayout>
        )}
      </div>
    </div>
  );
}

const styles = (theme: GrafanaTheme2) => ({
  page: css({ padding: theme.spacing(2) }),
  toolbar: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing(2), flexWrap: 'wrap', marginBottom: theme.spacing(1) }),
  title: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), h1: { fontSize: theme.typography.h3.fontSize, margin: 0, fontWeight: theme.typography.fontWeightMedium } }),
  tags: css({ marginLeft: theme.spacing(1), justifyContent: 'flex-start' }),
  actions: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  vars: css({ marginBottom: theme.spacing(1) }),
  grid: css({
    '.react-grid-item.react-grid-placeholder': { background: theme.colors.primary.main, opacity: 0.2, borderRadius: theme.shape.radius.default },
    '.react-grid-item > div': { height: '100%' },
    '.react-resizable-handle': { zIndex: 2 },
  }),
});
