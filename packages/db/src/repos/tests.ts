import { asc, eq, sql } from 'drizzle-orm';
import { testStepsSchema, type Step } from '@test-studio/core';
import type { Db } from '../client.js';
import { runs, tests } from '../schema.js';

export interface TestSummary {
  id: number;
  name: string;
  updatedAt: Date;
  stepCount: number;
  /** ผลการรันล่าสุด (null = ยังไม่เคยรัน) */
  lastPassed: boolean | null;
}

export interface TestRecord {
  id: number;
  projectId: number;
  name: string;
  steps: Step[];
  createdAt: Date;
  updatedAt: Date;
}

export function testsRepo(db: Db) {
  return {
    async list(projectId: number): Promise<TestSummary[]> {
      return db
        .select({
          id: tests.id,
          name: tests.name,
          updatedAt: tests.updatedAt,
          stepCount: sql<number>`jsonb_array_length(${tests.steps})::int`,
          // ต้องระบุชื่อตารางเอง: Drizzle เขียน ${tests.id} ใน subquery เป็น "id" เฉยๆ ซึ่งจะไปชี้ที่ runs.id แทน
          lastPassed: sql<boolean | null>`(select r.passed from ${runs} r where r.test_id = "tests"."id" order by r.id desc limit 1)`,
        })
        .from(tests)
        .where(eq(tests.projectId, projectId))
        .orderBy(asc(tests.id));
    },
    async get(id: number): Promise<TestRecord | null> {
      const [row] = await db.select().from(tests).where(eq(tests.id, id));
      return row ?? null;
    },
    async create(projectId: number, name: string): Promise<number> {
      const [row] = await db.insert(tests).values({ projectId, name }).returning({ id: tests.id });
      return row!.id;
    },
    async rename(id: number, name: string): Promise<void> {
      await db.update(tests).set({ name, updatedAt: sql`now()` }).where(eq(tests.id, id));
    },
    /** ตรวจรูปแบบด้วย stepSchema ก่อนเก็บเสมอ: ข้อมูลที่ผิดรูปแบบไม่เข้าฐานข้อมูล */
    async saveSteps(id: number, steps: unknown): Promise<void> {
      const valid = testStepsSchema.parse(steps);
      await db.update(tests).set({ steps: valid, updatedAt: sql`now()` }).where(eq(tests.id, id));
    },
    async remove(id: number): Promise<void> {
      await db.delete(tests).where(eq(tests.id, id));
    },
  };
}
