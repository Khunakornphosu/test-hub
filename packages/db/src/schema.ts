import { sql } from 'drizzle-orm';
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { BatchStatus, BatchTrigger, ChannelType, FailureAnalysis, NotifyOn, RunStepResult, RunTarget, ScheduleTiming, Step } from '@test-studio/core';

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

export interface FlowNodeRecord {
  id: string;
  type: 'testCase';
  testId: number;
  position: { x: number; y: number };
}

export interface FlowEdgeRecord {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export const flows = pgTable(
  'flows',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nodes: jsonb('nodes').$type<FlowNodeRecord[]>().notNull().default(sql`'[]'::jsonb`),
    edges: jsonb('edges').$type<FlowEdgeRecord[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('flows_project_idx').on(t.projectId)]
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

export const environments = pgTable(
  'environments',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('environments_project_name_idx').on(t.projectId, t.name)]
);

export const schedules = pgTable(
  'schedules',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    target: jsonb('target').$type<RunTarget>().notNull(),
    timing: jsonb('timing').$type<ScheduleTiming>().notNull(),
    environmentId: integer('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('schedules_project_idx').on(t.projectId), index('schedules_due_idx').on(t.enabled, t.nextRunAt)]
);

/** config เก็บเป็น JSON ที่เข้ารหัสแล้ว เพราะมี webhook URL / access token */
export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').$type<ChannelType>().notNull(),
    config: text('config').notNull(),
    notifyOn: text('notify_on').$type<NotifyOn>().notNull().default('problems'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('notification_channels_project_idx').on(t.projectId)]
);

/** token สำหรับ CI เก็บเฉพาะ hash (SHA-256) ค่าจริงแสดงครั้งเดียวตอนสร้าง */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text('prefix').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash), index('api_tokens_project_idx').on(t.projectId)]
);

/** รอบการรันที่ไม่ได้สั่งจาก Workspace (ตั้งเวลา / CI / กดรันจากหน้ารันอัตโนมัติ) เป็นคิวงานของ runner */
export const runBatches = pgTable(
  'run_batches',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    target: jsonb('target').$type<RunTarget>().notNull(),
    trigger: text('trigger').$type<BatchTrigger>().notNull(),
    label: text('label').notNull(),
    scheduleId: integer('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    environmentId: integer('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    environmentName: text('environment_name'),
    status: text('status').$type<BatchStatus>().notNull().default('queued'),
    total: integer('total').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** เทสที่พังแล้วรันซ้ำผ่าน (นับเป็นผ่าน) */
    flaky: integer('flaky').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('run_batches_status_idx').on(t.status, t.id), index('run_batches_project_idx').on(t.projectId, t.id)]
);

export const runs = pgTable(
  'runs',
  {
    id: serial('id').primaryKey(),
    testId: integer('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id').references(() => runBatches.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    passed: boolean('passed').notNull(),
    results: jsonb('results').$type<RunStepResult[]>().notNull(),
    /** screenshot ตอนพัง (JPEG) */
    screenshot: bytea('screenshot'),
    /** พังครั้งแรกแล้วรันซ้ำผ่าน */
    flaky: boolean('flaky').notNull().default(false),
    /** error ของครั้งแรกที่พัง (เมื่อรันซ้ำ) */
    retryError: text('retry_error'),
    /** สาเหตุที่น่าจะเป็นของการพัง (จากกฎหรือ AI) */
    analysis: jsonb('analysis').$type<FailureAnalysis>(),
  },
  (t) => [index('runs_test_idx').on(t.testId, t.id), index('runs_batch_idx').on(t.batchId)]
);

/** Playwright trace (zip) ของการรันที่พัง แยกตารางเพราะไฟล์ใหญ่ และลบเก่าทิ้งเป็นระยะ */
export const runTraces = pgTable('run_traces', {
  runId: integer('run_id').primaryKey().references(() => runs.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

/** ประวัติการสำรองฐานข้อมูล (ไฟล์อยู่ในเครื่องที่รัน runner) */
export const backups = pgTable('backups', {
  id: serial('id').primaryKey(),
  file: text('file'),
  bytes: integer('bytes'),
  ok: boolean('ok').notNull(),
  error: text('error'),
  durationMs: integer('duration_ms').notNull(),
  createdAt: createdAt(),
});
