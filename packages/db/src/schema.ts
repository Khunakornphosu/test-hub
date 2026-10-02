import { sql } from 'drizzle-orm';
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { RunStepResult, Step } from '@test-studio/core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const tests = pgTable(
  'tests',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    steps: jsonb('steps').$type<Step[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tests_project_idx').on(t.projectId)]
);

/** ค่าที่เก็บเป็นข้อความที่เข้ารหัสแล้ว (enc:v1:…) ไม่เคยเก็บค่าจริง */
export const secrets = pgTable(
  'secrets',
  {
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name] })]
);

export const runs = pgTable(
  'runs',
  {
    id: serial('id').primaryKey(),
    testId: integer('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    passed: boolean('passed').notNull(),
    results: jsonb('results').$type<RunStepResult[]>().notNull(),
    /** screenshot ตอนพัง (JPEG) */
    screenshot: bytea('screenshot'),
  },
  (t) => [index('runs_test_idx').on(t.testId, t.id)]
);
