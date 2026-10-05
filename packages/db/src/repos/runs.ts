import { and, desc, eq, sql } from 'drizzle-orm';
import { tests } from '../schema.js';
import { runResultsSchema, type RunStepResult } from '@test-studio/core';
import type { Db } from '../client.js';
import { runs } from '../schema.js';

export interface NewRun {
  testId: number;
  startedAt: Date;
  durationMs: number;
  passed: boolean;
  results: RunStepResult[];
  screenshot?: Buffer | null;
}

export interface RunSummary {
  id: number;
  startedAt: Date;
  durationMs: number;
  passed: boolean;
  hasScreenshot: boolean;
}

export interface RecentRun extends RunSummary {
  testId: number;
  testName: string;
  projectId: number;
}

export interface RunDetail extends RunSummary {
  testId: number;
  results: RunStepResult[];
}

const summaryColumns = {
  id: runs.id,
  startedAt: runs.startedAt,
  durationMs: runs.durationMs,
  passed: runs.passed,
  hasScreenshot: sql<boolean>`${runs.screenshot} is not null`,
};

export function runsRepo(db: Db) {
  return {
    async create(run: NewRun): Promise<number> {
      const [row] = await db
        .insert(runs)
        .values({
          testId: run.testId,
          startedAt: run.startedAt,
          durationMs: run.durationMs,
          passed: run.passed,
          results: runResultsSchema.parse(run.results),
          screenshot: run.screenshot ?? null,
        })
        .returning({ id: runs.id });
      return row!.id;
    },
    /** ประวัติล่าสุดของเทส (ใหม่สุดก่อน สูงสุด 50) */
    async list(testId: number): Promise<RunSummary[]> {
      return db.select(summaryColumns).from(runs).where(eq(runs.testId, testId)).orderBy(desc(runs.startedAt), desc(runs.id)).limit(50);
    },
    async get(id: number): Promise<RunDetail | null> {
      const [row] = await db.select({ ...summaryColumns, testId: runs.testId, results: runs.results }).from(runs).where(eq(runs.id, id));
      return row ?? null;
    },
    /** การรันล่าสุดของทุกเทส (หรือเฉพาะโปรเจกต์) ใหม่สุดก่อน */
    async listRecent(options: { projectId?: number; limit?: number } = {}): Promise<RecentRun[]> {
      const query = db
        .select({ ...summaryColumns, testId: runs.testId, testName: tests.name, projectId: tests.projectId })
        .from(runs)
        .innerJoin(tests, eq(tests.id, runs.testId));
      const filtered = options.projectId != null ? query.where(eq(tests.projectId, options.projectId)) : query;
      return filtered.orderBy(desc(runs.startedAt), desc(runs.id)).limit(Math.min(options.limit ?? 50, 200));
    },
    /** ผลการรันแบบแบ่งหน้า (ใหม่สุดก่อน) พร้อมจำนวนทั้งหมด */
    async listPage(options: { projectId?: number; testId?: number; batchId?: number; passed?: boolean; limit: number; offset: number }): Promise<{ items: RecentRun[]; total: number }> {
      const conditions = [
        options.projectId != null ? eq(tests.projectId, options.projectId) : undefined,
        options.testId != null ? eq(runs.testId, options.testId) : undefined,
        options.batchId != null ? eq(runs.batchId, options.batchId) : undefined,
        options.passed != null ? eq(runs.passed, options.passed) : undefined,
      ].filter((c) => c !== undefined);
      const where = conditions.length ? and(...conditions) : undefined;
      const limit = Math.min(Math.max(options.limit, 1), 100);
      const [items, [count]] = await Promise.all([
        db
          .select({ ...summaryColumns, testId: runs.testId, testName: tests.name, projectId: tests.projectId })
          .from(runs)
          .innerJoin(tests, eq(tests.id, runs.testId))
          .where(where)
          .orderBy(desc(runs.startedAt), desc(runs.id))
          .limit(limit)
          .offset(Math.max(options.offset, 0)),
        db.select({ total: sql<number>`count(*)::int` }).from(runs).innerJoin(tests, eq(tests.id, runs.testId)).where(where),
      ]);
      return { items, total: count?.total ?? 0 };
    },
    async screenshot(id: number): Promise<Buffer | null> {
      const [row] = await db.select({ screenshot: runs.screenshot }).from(runs).where(eq(runs.id, id));
      return row?.screenshot ?? null;
    },
    /** ผลรายสเต็ปของการรันล่าสุด ใช้คำนวณ locator health */
    async recentResults(testId: number, limit = 20): Promise<RunStepResult[][]> {
      const rows = await db.select({ results: runs.results }).from(runs).where(eq(runs.testId, testId)).orderBy(desc(runs.startedAt), desc(runs.id)).limit(limit);
      return rows.map((r) => r.results);
    },
  };
}
