// สถิติสำหรับ Dashboard (คำนวณใน Postgres ไม่ดึงทุกแถวมาคำนวณในแอป)
import { sql } from 'drizzle-orm';
import type { RunStepResult } from '@test-studio/core';
import type { Db } from '../client.js';

export interface StatsQuery {
  from: Date;
  to: Date;
  /** กรองเฉพาะโปรเจกต์ (ไม่ระบุ = ทุกโปรเจกต์) */
  projectId?: number;
}

export interface BucketPoint {
  /** เวลาเริ่มช่วง (ms) */
  t: number;
  passed: number;
  failed: number;
  avgMs: number;
}

export type TimelineState = 'p' | 'f' | 'h';

export interface FailureItem {
  runId: number;
  testId: number;
  testName: string;
  at: Date;
  stepNumber: number | null;
  message: string;
}

export interface Overview {
  totals: { runs: number; passed: number; failed: number; avgMs: number; healedSteps: number; pendingHeals: number };
  /** ช่วงเวลาของแต่ละช่อง (ms) */
  bucketMs: number;
  series: BucketPoint[];
  slowest: { testId: number; name: string; avgMs: number }[];
  /** สถานะการรันล่าสุดของแต่ละเทส เก่า -> ใหม่ */
  timeline: { testId: number; name: string; states: TimelineState[] }[];
  failures: FailureItem[];
}

/** ขนาดช่องที่ "ดูง่าย" ตามความยาวช่วงเวลา (ประมาณ 40-100 ช่อง) */
export function chooseBucketMs(fromMs: number, toMs: number): number {
  const nice = [60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3];
  const target = (toMs - fromMs) / 56;
  return nice.find((n) => n >= target) ?? nice.at(-1)!;
}

const TIMELINE_LENGTH = 40;
const MAX_FAILURES = 8;

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

export function statsRepo(db: Db) {
  return {
    async overview({ from, to, projectId }: StatsQuery): Promise<Overview> {
      const project = projectId != null ? sql`and t.project_id = ${projectId}` : sql``;
      const inRange = sql`r.started_at >= ${from.toISOString()}::timestamptz and r.started_at < ${to.toISOString()}::timestamptz`;
      const bucketMs = chooseBucketMs(from.getTime(), to.getTime());

      const [totalsRow] = (await db.execute(sql`
        select count(*)::int as runs,
               count(*) filter (where r.passed)::int as passed,
               count(*) filter (where not r.passed)::int as failed,
               coalesce(avg(r.duration_ms), 0)::float as avg_ms
        from runs r join tests t on t.id = r.test_id
        where ${inRange} ${project}`)) as Row[];

      // ขั้นที่ซ่อมอัตโนมัติในช่วงนี้ และที่ยังรอผู้ใช้ยืนยัน (ของการรันล่าสุดของแต่ละเทสเท่านั้น เพราะยืนยันแล้วการรันถัดไปจะไม่ซ่อมอีก)
      const [healRow] = (await db.execute(sql`
        select count(*)::int as healed_steps
        from runs r join tests t on t.id = r.test_id, jsonb_array_elements(r.results) e
        where ${inRange} ${project} and jsonb_array_length(coalesce(e->'healed', '[]'::jsonb)) > 0`)) as Row[];
      const [pendingRow] = (await db.execute(sql`
        select count(*)::int as pending
        from (select distinct on (r.test_id) r.results from runs r join tests t on t.id = r.test_id
              where true ${project} order by r.test_id, r.started_at desc, r.id desc) last,
             jsonb_array_elements(last.results) e
        where jsonb_array_length(coalesce(e->'healed', '[]'::jsonb)) > 0`)) as Row[];

      const bucketSql = sql`${bucketMs / 1000} * interval '1 second'`;
      const seriesRows = (await db.execute(sql`
        select (extract(epoch from date_bin(${bucketSql}, r.started_at, to_timestamp(0))) * 1000)::float8 as t,
               count(*) filter (where r.passed)::int as passed,
               count(*) filter (where not r.passed)::int as failed,
               avg(r.duration_ms)::float as avg_ms
        from runs r join tests t on t.id = r.test_id
        where ${inRange} ${project}
        group by 1 order by 1`)) as Row[];

      const slowestRows = (await db.execute(sql`
        select t.id, t.name, avg(r.duration_ms)::float as avg_ms
        from runs r join tests t on t.id = r.test_id
        where ${inRange} ${project}
        group by t.id, t.name order by avg_ms desc limit 5`)) as Row[];

      const timelineRows = (await db.execute(sql`
        select x.test_id, x.name, x.passed,
               exists (select 1 from jsonb_array_elements(x.results) e
                       where jsonb_array_length(coalesce(e->'healed', '[]'::jsonb)) > 0) as healed
        from (select r.test_id, t.name, r.passed, r.results,
                     row_number() over (partition by r.test_id order by r.started_at desc, r.id desc) as rn
              from runs r join tests t on t.id = r.test_id
              where true ${project}) x
        where x.rn <= ${TIMELINE_LENGTH}
        order by x.test_id, x.rn desc`)) as Row[];

      const failureRows = (await db.execute(sql`
        select r.id, r.test_id, t.name, r.started_at, r.results
        from runs r join tests t on t.id = r.test_id
        where not r.passed ${project}
        order by r.started_at desc, r.id desc limit ${MAX_FAILURES}`)) as Row[];

      const timeline = new Map<number, { testId: number; name: string; states: TimelineState[] }>();
      for (const r of timelineRows) {
        const testId = num(r.test_id);
        const entry = timeline.get(testId) ?? { testId, name: String(r.name), states: [] };
        entry.states.push(!r.passed ? 'f' : r.healed ? 'h' : 'p');
        timeline.set(testId, entry);
      }

      const totals = totalsRow!;
      return {
        totals: {
          runs: num(totals.runs),
          passed: num(totals.passed),
          failed: num(totals.failed),
          avgMs: num(totals.avg_ms),
          healedSteps: num(healRow?.healed_steps),
          pendingHeals: num(pendingRow?.pending),
        },
        bucketMs,
        series: seriesRows.map((r) => ({ t: num(r.t), passed: num(r.passed), failed: num(r.failed), avgMs: num(r.avg_ms) })),
        slowest: slowestRows.map((r) => ({ testId: num(r.id), name: String(r.name), avgMs: num(r.avg_ms) })),
        timeline: [...timeline.values()],
        failures: failureRows.map((r) => {
          const results = r.results as RunStepResult[];
          const index = results.findIndex((s) => s.status === 'failed');
          return {
            runId: num(r.id),
            testId: num(r.test_id),
            testName: String(r.name),
            at: new Date(r.started_at as string | Date),
            stepNumber: index >= 0 ? index + 1 : null,
            message: results[index]?.error ?? 'ไม่ผ่าน',
          };
        }),
      };
    },
  };
}
