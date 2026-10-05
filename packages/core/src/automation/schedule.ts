import { DEFAULT_TIMEZONE, type ScheduleTiming } from './types.js';

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

/** ส่วนวันที่/เวลาตามเขตเวลา tz ของเวลา instant */
function zonedParts(instant: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { year: +get('year'), month: +get('month'), day: +get('day'), hour: +get('hour'), minute: +get('minute'), second: +get('second'), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
}

/** เวลา UTC ของ "วันที่ y-m-d เวลา hh:mm ตามเขตเวลา tz" */
function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = zonedParts(new Date(guess), tz);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return new Date(guess - offset);
}

/** เวลารันครั้งถัดไปหลังจาก from (ไม่รวม from) */
export function nextRunAt(timing: ScheduleTiming, from: Date = new Date()): Date {
  if (timing.kind === 'interval') return new Date(from.getTime() + timing.minutes * 60_000);
  const tz = timing.timezone || DEFAULT_TIMEZONE;
  const [hh, mm] = timing.time.split(':').map(Number) as [number, number];
  const today = zonedParts(from, tz);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (candidate > from && timing.days.includes(day.getUTCDay())) return candidate;
  }
  throw new Error('คำนวณเวลารันครั้งถัดไปไม่ได้');
}

/** ข้อความอธิบายตารางเวลาเป็นภาษาไทย เช่น "ทุก 30 นาที", "ทุกวัน 08:00", "จ.–ศ. 08:00" */
export function describeTiming(timing: ScheduleTiming): string {
  if (timing.kind === 'interval') return timing.minutes % 60 === 0 ? `ทุก ${timing.minutes / 60} ชั่วโมง` : `ทุก ${timing.minutes} นาที`;
  const days = [...new Set(timing.days)].sort();
  const label =
    days.length === 7 ? 'ทุกวัน' : days.join() === '1,2,3,4,5' ? 'จ.–ศ.' : days.join() === '0,6' ? 'ส.–อา.' : days.map((d) => DAY_NAMES[d]).join(' ');
  return `${label} ${timing.time}`;
}
