'use client';
import { useMemo } from 'react';
import { css } from '@emotion/css';
import { FieldType, VizOrientation, type DataFrame, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { LegendDisplayMode, type VizLegendOptions } from '@grafana/schema';
import { BarGauge, BarGaugeDisplayMode, BigValue, BigValueColorMode, BigValueGraphMode, BigValueTextMode, Menu, PanelChrome, Table, TimeSeries, useStyles2, useTheme2 } from '@grafana/ui';
import { getDisplayProcessor } from '@grafana/data';
import Measured from './Measured';
import { failuresFrames, rateFrames, runsFrames, statValue, stats, thresholdsSec } from '@/lib/gdata';

// เมนู ⋮ ของ panel แบบ Grafana
export const panelMenu = (
  <Menu>
    <Menu.Item label="ดู" icon="eye" shortcut="v" />
    <Menu.Item label="แก้ไข" icon="edit" shortcut="e" />
    <Menu.Item label="แชร์" icon="share-alt" shortcut="p s" />
    <Menu.Item label="ตรวจสอบ" icon="info-circle" shortcut="i" />
    <Menu.Divider />
    <Menu.Item label="เพิ่มเติม" icon="cube" childItems={[<Menu.Item key="d" label="ทำสำเนา" icon="copy" shortcut="p d" />, <Menu.Item key="x" label="ส่งออก CSV" icon="download-alt" />]} />
    <Menu.Divider />
    <Menu.Item label="ลบ" icon="trash-alt" shortcut="p r" destructive />
  </Menu>
);

const DRAG = 'panel-drag-handle';

export function StatPanel({ title, k, unit }: { title: string; k: keyof typeof stats; unit?: string }) {
  const theme = useTheme2();
  const cfg = stats[k];
  const { display, sparkline } = useMemo(() => statValue(theme, cfg.value, cfg.cfg, cfg.color, cfg.series), [theme, cfg]);
  return (
    <PanelChrome title={title} menu={panelMenu} dragClass={DRAG}>
      <Measured>{(w, h) => (
        <BigValue
          width={w}
          height={h}
          theme={theme}
          value={{ ...display, suffix: display.suffix ?? (unit ? ` ${unit}` : '') }}
          sparkline={sparkline}
          colorMode={BigValueColorMode.Value}
          graphMode={BigValueGraphMode.Area}
          textMode={BigValueTextMode.Auto}
          count={1}
        />
      )}</Measured>
    </PanelChrome>
  );
}

const legendTable: VizLegendOptions = { displayMode: LegendDisplayMode.Table, placement: 'bottom', showLegend: true, calcs: ['mean', 'max', 'lastNotNull'] };

function Series({ frames, timeRange, legend = legendTable }: { frames: DataFrame[]; timeRange: TimeRange; legend?: VizLegendOptions }) {
  return (
    <Measured>
      {(w, h) => <TimeSeries frames={frames} width={w} height={h} timeRange={timeRange} timeZone="browser" legend={legend} />}
    </Measured>
  );
}

export function RunsPanel({ timeRange }: { timeRange: TimeRange }) {
  const theme = useTheme2();
  const frames = useMemo(() => runsFrames(theme), [theme]);
  return (
    <PanelChrome title="การรันเทส (ผ่าน / ไม่ผ่าน)" description="จำนวนการรันแยกตามผล ช่วงละ 3 ชั่วโมง" menu={panelMenu} dragClass={DRAG}>
      <Series frames={frames} timeRange={timeRange} />
    </PanelChrome>
  );
}

export function RatePanel({ timeRange }: { timeRange: TimeRange }) {
  const theme = useTheme2();
  const frames = useMemo(() => rateFrames(theme), [theme]);
  return (
    <PanelChrome title="อัตราผ่านและเวลาเฉลี่ย" menu={panelMenu} dragClass={DRAG}>
      <Series frames={frames} timeRange={timeRange} />
    </PanelChrome>
  );
}

const slowest = [
  { name: 'Checkout บัตรเครดิต', sec: 12.4 },
  { name: 'ออกใบกำกับภาษี', sec: 9.8 },
  { name: 'สมัครสมาชิก', sec: 5.6 },
  { name: 'แก้ไขโปรไฟล์', sec: 4.4 },
  { name: 'ค้นหาสินค้า', sec: 4.1 },
];

export function SlowestPanel() {
  const theme = useTheme2();
  const s = useStyles2(gaugeStyles);
  return (
    <PanelChrome title="เทสที่ช้าที่สุด" menu={panelMenu} dragClass={DRAG}>
      <Measured>{(w, h) => {
        const rowH = Math.max(34, Math.floor((h - 8) / slowest.length));
        return (
          <div className={s.wrap}>
            {slowest.map((r) => {
              const field = { name: r.name, type: FieldType.number, values: [r.sec], config: { unit: 's', decimals: 1, min: 0, max: 14, thresholds: thresholdsSec, color: { mode: 'thresholds' } } };
              const display = getDisplayProcessor({ field: field as never, theme })(r.sec);
              return (
                <div key={r.name} className={s.row} style={{ height: rowH }}>
                  <div className={s.name} title={r.name}>{r.name}</div>
                  <div className={s.bar}>
                    <BarGauge width={Math.max(60, w - 190)} height={Math.min(rowH - 6, 26)} value={display} display={getDisplayProcessor({ field: field as never, theme })} field={field.config as never} orientation={VizOrientation.Horizontal} displayMode={BarGaugeDisplayMode.Gradient} theme={theme} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      }}</Measured>
    </PanelChrome>
  );
}
const gaugeStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ padding: theme.spacing(0.5, 1) }),
  row: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  name: css({ width: 150, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: theme.typography.bodySmall.fontSize }),
  bar: css({ flex: 1, minWidth: 0 }),
});

// State timeline: ซ้าย=เก่า ขวา=ใหม่ (ชุด @grafana/ui ไม่มี component นี้ จึงวาดเองด้วยสีของ Grafana)
const timeline: Record<string, string> = {
  'Login ด้วยอีเมล': 'pppppppppppphpppppppppppppppppppppppppp',
  'Checkout บัตรเครดิต': 'pppppffppppppfffppfpfppfpppfppffpppfpff',
  'ค้นหาสินค้า': 'pppphppppphpppphppppphphpppphpppppphpphp',
  'สมัครสมาชิก': 'ppppppppppppppppfpppnpppppppppppppppfppp',
  'แก้ไขโปรไฟล์': 'pppppppppppppppppppppppppppppppppppppppp',
  'ออกใบกำกับภาษี': 'ppfppppffppfppfffpfpfffppfppfpfffppfpff',
};

export function StatePanel() {
  const theme = useTheme2();
  const s = useStyles2(stateStyles);
  const color = { p: theme.visualization.getColorByName('green'), f: theme.visualization.getColorByName('red'), h: theme.visualization.getColorByName('orange'), n: theme.colors.background.secondary };
  const label = { p: 'ผ่าน', f: 'ไม่ผ่าน', h: 'ผ่านแต่ซ่อม locator', n: 'ไม่ได้รัน' } as const;
  return (
    <PanelChrome title="สถานะรายเทส" menu={panelMenu} dragClass={DRAG}>
      <Measured>{(w, h) => (
        <div className={s.wrap} style={{ width: w, height: h }}>
          <div className={s.rows}>
            {Object.entries(timeline).map(([name, st]) => (
              <div key={name} className={s.line}>
                <div className={s.name} title={name}>{name}</div>
                <div className={s.cells}>
                  {st.split('').map((c, i) => (
                    <span key={i} className={s.cell} style={{ background: color[c as 'p'], opacity: c === 'n' ? 1 : 0.8 }} title={`${label[c as 'p']}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className={s.legend}>
            {(['p', 'h', 'f'] as const).map((k) => (
              <span key={k} className={s.legendItem}><i style={{ background: color[k] }} />{label[k]}</span>
            ))}
          </div>
        </div>
      )}</Measured>
    </PanelChrome>
  );
}
const stateStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ display: 'flex', flexDirection: 'column', padding: theme.spacing(0.5, 1), gap: theme.spacing(1) }),
  rows: css({ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }),
  line: css({ flex: 1, display: 'flex', alignItems: 'stretch', gap: theme.spacing(1.5), minHeight: 0, maxHeight: 30 }),
  name: css({ width: 150, flex: 'none', display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: theme.typography.bodySmall.fontSize }),
  cells: css({ flex: 1, display: 'flex', gap: 2 }),
  cell: css({ flex: 1, borderRadius: 2, '&:hover': { opacity: '1 !important', outline: `1px solid ${theme.colors.text.primary}` } }),
  legend: css({ display: 'flex', gap: theme.spacing(2), justifyContent: 'flex-end', fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary }),
  legendItem: css({ display: 'inline-flex', alignItems: 'center', gap: 6, i: { width: 10, height: 10, borderRadius: 2, display: 'inline-block' } }),
});

export function FailuresPanel() {
  const theme = useTheme2();
  const frames = useMemo(() => failuresFrames(theme), [theme]);
  return (
    <PanelChrome title="ผลการรันล่าสุด" menu={panelMenu} dragClass={DRAG}>
      <Measured>{(w, h) => <Table data={frames[0]} width={w} height={h} cellHeight={'sm' as never} />}</Measured>
    </PanelChrome>
  );
}
