// ข้อมูลจำลองในรูปแบบ DataFrame ของ Grafana (คำนวณจากสูตรคงที่ ไม่สุ่ม)
import { FieldColorModeId, FieldType, MappingType, ThresholdsMode, applyFieldOverrides, getDisplayProcessor, toDataFrame, type DataFrame, type DisplayValue, type Field, type FieldConfig, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { AxisPlacement, GraphDrawStyle, StackingMode, TableCellDisplayMode } from '@grafana/schema';

const HOUR = 3600_000;
const fixed = (color: string): FieldConfig['color'] => ({ mode: FieldColorModeId.Fixed, fixedColor: color });

export const palette = { green: 'green', red: 'red', yellow: 'yellow', blue: 'blue', orange: 'orange', purple: 'purple' } as const;

// เวลา 7 วันล่าสุด ทุก 3 ชั่วโมง (แท่ง) และรายชั่วโมง (เส้น) นับถึง "ตอนนี้"
export function buildTimes(count: number, stepMs: number, now = Date.now()) {
  return Array.from({ length: count }, (_, i) => now - (count - 1 - i) * stepMs);
}

const work = (t: number) => {
  const d = new Date(t);
  const day = d.getDay();
  const hour = d.getHours();
  const weekend = day === 0 || day === 6 ? 0.35 : 1;
  const daytime = hour >= 8 && hour <= 19 ? 1 : 0.25;
  return weekend * daytime;
};

export function runsFrames(theme: GrafanaTheme2, now?: number): DataFrame[] {
  const time = buildTimes(56, 3 * HOUR, now);
  const passed = time.map((t, i) => Math.round(work(t) * (46 + Math.sin(i / 2.2) * 9)));
  const failed = time.map((t, i) => Math.max(0, Math.round(work(t) * (3 + Math.cos(i * 1.7) * 2.2))));
  const stack = { mode: StackingMode.Normal, group: 'A' };
  const bars = { drawStyle: GraphDrawStyle.Bars, fillOpacity: 75, lineWidth: 1, stacking: stack, barWidthFactor: 0.85, showPoints: 'never' };
  const frame = toDataFrame({
    name: 'runs',
    fields: [
      { name: 'Time', type: FieldType.time, values: time },
      { name: 'ผ่าน', type: FieldType.number, values: passed, config: { color: fixed(palette.green), custom: bars, decimals: 0 } },
      { name: 'ไม่ผ่าน', type: FieldType.number, values: failed, config: { color: fixed(palette.red), custom: bars, decimals: 0 } },
    ],
  });
  return process([frame], theme);
}

export function rateFrames(theme: GrafanaTheme2, now?: number): DataFrame[] {
  const time = buildTimes(168, HOUR, now);
  const rate = time.map((t, i) => Math.min(100, 93.5 + Math.sin(i / 7) * 2.4 + Math.cos(i / 3.1) * 1.2 - (work(t) < 0.5 ? -1.5 : 0)));
  const dur = time.map((t, i) => 4.6 + Math.sin(i / 9 + 1) * 0.7 + Math.cos(i / 2.4) * 0.25);
  const line = { drawStyle: GraphDrawStyle.Line, lineWidth: 2, fillOpacity: 8, showPoints: 'never', lineInterpolation: 'smooth' };
  const frame = toDataFrame({
    name: 'rate',
    fields: [
      { name: 'Time', type: FieldType.time, values: time },
      { name: 'อัตราผ่าน', type: FieldType.number, values: rate, config: { unit: 'percent', decimals: 1, min: 80, max: 100, color: fixed(palette.green), custom: line } },
      { name: 'เวลาเฉลี่ย', type: FieldType.number, values: dur, config: { unit: 's', decimals: 1, min: 0, max: 10, color: fixed(palette.purple), custom: { ...line, axisPlacement: AxisPlacement.Right } } },
    ],
  });
  return process([frame], theme);
}

function process(data: DataFrame[], theme: GrafanaTheme2): DataFrame[] {
  return applyFieldOverrides({ data, fieldConfig: { defaults: {}, overrides: [] }, replaceVariables: (v) => v, theme, timeZone: 'browser' });
}

// ค่าสำหรับ panel แบบ Stat (ตัวเลขใหญ่ + กราฟเส้นเล็ก)
export function statValue(theme: GrafanaTheme2, value: number, cfg: FieldConfig, color: string, series: number[], now?: number) {
  const time = buildTimes(series.length, (7 * 24 * HOUR) / series.length, now);
  const y: Field = { name: 'value', type: FieldType.number, values: series, config: { ...cfg, color: fixed(color) } };
  const x: Field = { name: 'Time', type: FieldType.time, values: time, config: {} };
  const [frame] = process([toDataFrame({ fields: [x, y] })], theme);
  const yField = frame.fields[1];
  const display: DisplayValue = getDisplayProcessor({ field: yField, theme })(value);
  const timeRange = { from: { valueOf: () => time[0] }, to: { valueOf: () => time.at(-1)! } } as unknown as TimeRange;
  return { display, sparkline: { y: yField, x: frame.fields[0], timeRange } };
}

export const stats = {
  passRate: { value: 94.2, series: [92, 93.4, 91.1, 94.6, 95.2, 93.9, 94.8, 94.2, 95.6, 93.1, 94.9, 95.8, 94.4, 94.2], cfg: { unit: 'percent', decimals: 1 } as FieldConfig, color: palette.green },
  runs: { value: 131, series: [118, 126, 120, 130, 137, 44, 40, 127, 129, 127, 138, 131, 46, 41], cfg: { decimals: 0 } as FieldConfig, color: palette.blue },
  duration: { value: 4.8, series: [5.1, 4.9, 5.3, 4.8, 4.6, 4.7, 4.5, 5.0, 4.9, 4.7, 4.6, 4.8, 4.9, 4.8], cfg: { unit: 's', decimals: 1 } as FieldConfig, color: palette.purple },
  healed: { value: 7, series: [1, 0, 2, 1, 0, 0, 0, 3, 1, 0, 1, 2, 0, 0], cfg: { decimals: 0 } as FieldConfig, color: palette.yellow },
};

// ผลการรันล่าสุดสำหรับ Table panel (สถานะแสดงเป็นสีพื้นหลังผ่าน value mapping)
export function failuresFrames(theme: GrafanaTheme2, now = Date.now()): DataFrame[] {
  const rows = [
    [now - 12 * 60_000, 'Checkout บัตรเครดิต', 11, 'failed', 'ข้อความไม่ตรง: คาดว่ามี "ชำระเงินสำเร็จ" แต่เจอ "บัตรถูกปฏิเสธ"', 12.4],
    [now - 26 * 60_000, 'ออกใบกำกับภาษี', 6, 'failed', 'หา element ไม่เจอ หรือ element ยังไม่พร้อมใช้งานภายใน 5 วินาที', 9.8],
    [now - 61 * 60_000, 'ค้นหาสินค้า', 3, 'healed', 'ผ่านแต่ซ่อม locator อัตโนมัติ: ปุ่ม "ค้นหา"', 4.1],
    [now - 2.7 * HOUR, 'Checkout บัตรเครดิต', 11, 'failed', 'ข้อความไม่ตรง: คาดว่ามี "ชำระเงินสำเร็จ" แต่เจอ "บัตรถูกปฏิเสธ"', 12.1],
    [now - 4.1 * HOUR, 'ออกใบกำกับภาษี', 14, 'failed', 'URL ไม่ตรง: คาดว่า /invoices/done แต่เป็น /invoices/new', 10.3],
    [now - 5.5 * HOUR, 'Login ด้วยอีเมล', 5, 'passed', 'ผ่านทุก step', 3.2],
  ];
  const col = (i: number) => rows.map((r) => r[i]);
  const statusMap: FieldConfig = {
    mappings: [
      { type: MappingType.ValueToText, options: { passed: { text: 'ผ่าน', color: 'green', index: 0 }, failed: { text: 'ไม่ผ่าน', color: 'red', index: 1 }, healed: { text: 'ซ่อมแล้ว', color: 'orange', index: 2 } } },
    ],
    custom: { cellOptions: { type: TableCellDisplayMode.ColorBackground }, width: 100 },
  };
  const frame = toDataFrame({
    fields: [
      { name: 'เวลา', type: FieldType.time, values: col(0), config: { custom: { width: 150 } } },
      { name: 'สถานะ', type: FieldType.string, values: col(3), config: statusMap },
      { name: 'เทส', type: FieldType.string, values: col(1), config: { custom: { width: 190 } } },
      { name: 'ขั้นที่', type: FieldType.number, values: col(2), config: { decimals: 0, custom: { width: 80 } } },
      { name: 'รายละเอียด', type: FieldType.string, values: col(4), config: {} },
      { name: 'ใช้เวลา', type: FieldType.number, values: col(5), config: { unit: 's', decimals: 1, custom: { width: 90 } } },
    ],
  });
  return process([frame], theme);
}

export const thresholdsSec = { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }, { value: 6, color: 'orange' }, { value: 10, color: 'red' }] };
