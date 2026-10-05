// รันอัตโนมัติ: environment, ตั้งเวลา, ช่องทางแจ้งเตือน, token ของ CI และคิวรอบการรัน (run_batches)
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, lt, ne, sql } from 'drizzle-orm';
import {
  channelConfigSchema,
  nextRunAt,
  runTargetSchema,
  scheduleTimingSchema,
  type BatchStatus,
  type BatchTrigger,
  type ChannelConfig,
  type ChannelType,
  type Cipher,
  type NotifyOn,
  type RunTarget,
  type ScheduleTiming,
} from '@test-studio/core';
import type { Db } from '../client.js';
import { apiTokens, environments, notificationChannels, runBatches, schedules } from '../schema.js';

// ---------- environment ----------

export interface EnvironmentRecord { id: number; projectId: number; name: string; baseUrl: string }
const envColumns = { id: environments.id, projectId: environments.projectId, name: environments.name, baseUrl: environments.baseUrl };

export function environmentsRepo(db: Db) {
  return {
    async list(projectId: number): Promise<EnvironmentRecord[]> {
      return db.select(envColumns).from(environments).where(eq(environments.projectId, projectId)).orderBy(asc(environments.name));
    },
    async get(id: number): Promise<EnvironmentRecord | null> {
      const [row] = await db.select(envColumns).from(environments).where(eq(environments.id, id));
      return row ?? null;
    },
    async findByName(projectId: number, name: string): Promise<EnvironmentRecord | null> {
      const [row] = await db.select(envColumns).from(environments).where(and(eq(environments.projectId, projectId), eq(environments.name, name)));
      return row ?? null;
    },
    async create(projectId: number, value: { name: string; baseUrl: string }): Promise<number> {
      const [row] = await db.insert(environments).values({ projectId, ...value }).returning({ id: environments.id });
      return row!.id;
    },
    async update(id: number, value: { name?: string; baseUrl?: string }): Promise<void> {
      await db.update(environments).set(value).where(eq(environments.id, id));
    },
    async remove(id: number): Promise<void> {
      await db.delete(environments).where(eq(environments.id, id));
    },
  };
}

// ---------- ตั้งเวลา ----------

export interface ScheduleRecord {
  id: number;
  projectId: number;
  name: string;
  target: RunTarget;
  timing: ScheduleTiming;
  environmentId: number | null;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
}
export interface ScheduleInput { name: string; target: RunTarget; timing: ScheduleTiming; environmentId: number | null; enabled: boolean }

const scheduleColumns = {
  id: schedules.id,
  projectId: schedules.projectId,
  name: schedules.name,
  target: schedules.target,
  timing: schedules.timing,
  environmentId: schedules.environmentId,
  enabled: schedules.enabled,
  nextRunAt: schedules.nextRunAt,
  lastRunAt: schedules.lastRunAt,
};

export function schedulesRepo(db: Db) {
  return {
    async list(projectId: number): Promise<ScheduleRecord[]> {
      return db.select(scheduleColumns).from(schedules).where(eq(schedules.projectId, projectId)).orderBy(asc(schedules.id));
    },
    async get(id: number): Promise<ScheduleRecord | null> {
      const [row] = await db.select(scheduleColumns).from(schedules).where(eq(schedules.id, id));
      return row ?? null;
    },
    async create(projectId: number, input: ScheduleInput, now = new Date()): Promise<number> {
      const timing = scheduleTimingSchema.parse(input.timing);
      const [row] = await db
        .insert(schedules)
        .values({ projectId, name: input.name, target: runTargetSchema.parse(input.target), timing, environmentId: input.environmentId, enabled: input.enabled, nextRunAt: nextRunAt(timing, now) })
        .returning({ id: schedules.id });
      return row!.id;
    },
    /** แก้ตารางเวลาแล้วคำนวณเวลารันครั้งถัดไปใหม่ */
    async update(id: number, input: ScheduleInput, now = new Date()): Promise<void> {
      const timing = scheduleTimingSchema.parse(input.timing);
      await db
        .update(schedules)
        .set({ name: input.name, target: runTargetSchema.parse(input.target), timing, environmentId: input.environmentId, enabled: input.enabled, nextRunAt: nextRunAt(timing, now) })
        .where(eq(schedules.id, id));
    },
    async remove(id: number): Promise<void> {
      await db.delete(schedules).where(eq(schedules.id, id));
    },
    /**
     * หยิบตารางเวลาที่ถึงเวลาแล้วใส่คิว (หลาย runner เรียกพร้อมกันได้ แต่ละแถวถูกหยิบครั้งเดียว)
     * เวลาครั้งถัดไปนับจากตอนนี้ จึงไม่รันย้อนหลังรัวๆ ถ้าเครื่องปิดไปนาน
     */
    async enqueueDue(now = new Date()): Promise<number[]> {
      return db.transaction(async (tx) => {
        const due = await tx.execute<{ id: number }>(
          sql`select id from ${schedules} where enabled and next_run_at <= ${now.toISOString()}::timestamptz order by next_run_at limit 20 for update skip locked`
        );
        const batchIds: number[] = [];
        for (const { id } of due) {
          const [s] = await tx.select(scheduleColumns).from(schedules).where(eq(schedules.id, id));
          if (!s) continue;
          const env = s.environmentId ? (await tx.select(envColumns).from(environments).where(eq(environments.id, s.environmentId)))[0] : undefined;
          await tx.update(schedules).set({ nextRunAt: nextRunAt(s.timing, now), lastRunAt: now }).where(eq(schedules.id, id));
          const [batch] = await tx
            .insert(runBatches)
            .values({ projectId: s.projectId, target: s.target, trigger: 'schedule', label: s.name, scheduleId: s.id, environmentId: env?.id ?? null, environmentName: env?.name ?? null })
            .returning({ id: runBatches.id });
          batchIds.push(batch!.id);
        }
        return batchIds;
      });
    },
  };
}

// ---------- ช่องทางแจ้งเตือน ----------

export interface ChannelSummary { id: number; projectId: number; name: string; type: ChannelType; notifyOn: NotifyOn; enabled: boolean; destination: string }
export interface ChannelWithConfig extends ChannelSummary { config: ChannelConfig }

/** แสดงปลายทางแบบย่อ ไม่เผย webhook URL / token เต็ม */
function describeDestination(config: ChannelConfig): string {
  if (config.type === 'line') return `ส่งถึง ${config.to.slice(0, 5)}…${config.to.slice(-4)}`;
  try {
    const url = new URL(config.url);
    return `${url.host}/…${url.pathname.slice(-4)}`;
  } catch {
    return 'webhook';
  }
}

export function channelsRepo(db: Db, cipher: Cipher) {
  const columns = { id: notificationChannels.id, projectId: notificationChannels.projectId, name: notificationChannels.name, type: notificationChannels.type, notifyOn: notificationChannels.notifyOn, enabled: notificationChannels.enabled, config: notificationChannels.config };
  const decode = (row: { config: string } & Omit<ChannelSummary, 'destination'>): ChannelWithConfig | null => {
    try {
      const config = channelConfigSchema.parse(JSON.parse(cipher.decrypt(row.config)));
      return { ...row, config, destination: describeDestination(config) };
    } catch {
      console.warn(`[security] ถอดรหัสช่องทางแจ้งเตือน #${row.id} ไม่ได้ — SECRET_KEY อาจถูกเปลี่ยน`);
      return null;
    }
  };
  return {
    /** สำหรับหน้าเว็บ: ไม่มีค่าลับ */
    async list(projectId: number): Promise<ChannelSummary[]> {
      const rows = await db.select(columns).from(notificationChannels).where(eq(notificationChannels.projectId, projectId)).orderBy(asc(notificationChannels.id));
      return rows.map((r) => {
        const decoded = decode(r);
        return { id: r.id, projectId: r.projectId, name: r.name, type: r.type, notifyOn: r.notifyOn, enabled: r.enabled, destination: decoded?.destination ?? 'ถอดรหัสไม่ได้ (ตั้งใหม่)' };
      });
    },
    /** สำหรับ runner/ปุ่มทดสอบ: มี config จริง */
    async get(id: number): Promise<ChannelWithConfig | null> {
      const [row] = await db.select(columns).from(notificationChannels).where(eq(notificationChannels.id, id));
      return row ? decode(row) : null;
    },
    async enabledFor(projectId: number): Promise<ChannelWithConfig[]> {
      const rows = await db.select(columns).from(notificationChannels).where(and(eq(notificationChannels.projectId, projectId), eq(notificationChannels.enabled, true)));
      return rows.map(decode).filter((c): c is ChannelWithConfig => c != null);
    },
    async create(projectId: number, value: { name: string; config: ChannelConfig; notifyOn: NotifyOn }): Promise<number> {
      const config = channelConfigSchema.parse(value.config);
      const [row] = await db
        .insert(notificationChannels)
        .values({ projectId, name: value.name, type: config.type, config: cipher.encrypt(JSON.stringify(config)), notifyOn: value.notifyOn })
        .returning({ id: notificationChannels.id });
      return row!.id;
    },
    async update(id: number, value: { name?: string; notifyOn?: NotifyOn; enabled?: boolean }): Promise<void> {
      await db.update(notificationChannels).set(value).where(eq(notificationChannels.id, id));
    },
    async remove(id: number): Promise<void> {
      await db.delete(notificationChannels).where(eq(notificationChannels.id, id));
    },
  };
}

// ---------- token สำหรับ CI ----------

export interface ApiTokenSummary { id: number; projectId: number; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null }
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function tokensRepo(db: Db) {
  const columns = { id: apiTokens.id, projectId: apiTokens.projectId, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt };
  return {
    async list(projectId: number): Promise<ApiTokenSummary[]> {
      return db.select(columns).from(apiTokens).where(eq(apiTokens.projectId, projectId)).orderBy(desc(apiTokens.id));
    },
    async get(id: number): Promise<ApiTokenSummary | null> {
      const [row] = await db.select(columns).from(apiTokens).where(eq(apiTokens.id, id));
      return row ?? null;
    },
    /** คืน token จริงครั้งเดียว ฐานข้อมูลเก็บแค่ hash */
    async create(projectId: number, name: string): Promise<{ id: number; token: string }> {
      const token = `tsk_${randomBytes(32).toString('base64url')}`;
      const [row] = await db.insert(apiTokens).values({ projectId, name, tokenHash: hashToken(token), prefix: token.slice(0, 10) }).returning({ id: apiTokens.id });
      return { id: row!.id, token };
    },
    async verify(token: string): Promise<{ id: number; projectId: number } | null> {
      if (!token.startsWith('tsk_')) return null;
      const [row] = await db
        .update(apiTokens)
        .set({ lastUsedAt: sql`now()` })
        .where(eq(apiTokens.tokenHash, hashToken(token)))
        .returning({ id: apiTokens.id, projectId: apiTokens.projectId });
      return row ?? null;
    },
    async remove(id: number): Promise<void> {
      await db.delete(apiTokens).where(eq(apiTokens.id, id));
    },
  };
}

// ---------- รอบการรัน (คิวงานของ runner) ----------

export interface BatchRecord {
  id: number;
  projectId: number;
  target: RunTarget;
  trigger: BatchTrigger;
  label: string;
  scheduleId: number | null;
  environmentId: number | null;
  environmentName: string | null;
  status: BatchStatus;
  total: number;
  failed: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}
export interface NewBatch { projectId: number; target: RunTarget; trigger: BatchTrigger; label: string; scheduleId?: number | null; environmentId?: number | null; environmentName?: string | null }

const batchColumns = {
  id: runBatches.id,
  projectId: runBatches.projectId,
  target: runBatches.target,
  trigger: runBatches.trigger,
  label: runBatches.label,
  scheduleId: runBatches.scheduleId,
  environmentId: runBatches.environmentId,
  environmentName: runBatches.environmentName,
  status: runBatches.status,
  total: runBatches.total,
  failed: runBatches.failed,
  error: runBatches.error,
  createdAt: runBatches.createdAt,
  startedAt: runBatches.startedAt,
  finishedAt: runBatches.finishedAt,
};

export function batchesRepo(db: Db) {
  return {
    async enqueue(batch: NewBatch): Promise<number> {
      const [row] = await db.insert(runBatches).values({ ...batch, target: runTargetSchema.parse(batch.target) }).returning({ id: runBatches.id });
      return row!.id;
    },
    async get(id: number): Promise<BatchRecord | null> {
      const [row] = await db.select(batchColumns).from(runBatches).where(eq(runBatches.id, id));
      return row ?? null;
    },
    async list(projectId: number, options: { limit: number; offset: number }): Promise<{ items: BatchRecord[]; total: number }> {
      const where = eq(runBatches.projectId, projectId);
      const [items, [count]] = await Promise.all([
        db.select(batchColumns).from(runBatches).where(where).orderBy(desc(runBatches.id)).limit(Math.min(Math.max(options.limit, 1), 100)).offset(Math.max(options.offset, 0)),
        db.select({ total: sql<number>`count(*)::int` }).from(runBatches).where(where),
      ]);
      return { items, total: count?.total ?? 0 };
    },
    /** หยิบงานถัดไปในคิว (แต่ละงานถูกหยิบครั้งเดียวแม้มีหลาย runner) */
    async claimNext(): Promise<BatchRecord | null> {
      const rows = await db.execute<{ id: number }>(sql`
        update ${runBatches} set status = 'running', started_at = now()
        where id = (select id from ${runBatches} where status = 'queued' order by id limit 1 for update skip locked)
        returning id`);
      const id = rows[0]?.id;
      return id ? this.get(id) : null;
    },
    async progress(id: number, value: { total: number; failed: number }): Promise<void> {
      await db.update(runBatches).set(value).where(eq(runBatches.id, id));
    },
    async finish(id: number, value: { total: number; failed: number; error?: string | null }): Promise<void> {
      await db.update(runBatches).set({ ...value, error: value.error ?? null, status: value.error ? 'error' : 'done', finishedAt: sql`now()` }).where(eq(runBatches.id, id));
    },
    /** รอบก่อนหน้าของตารางเวลาเดียวกัน (หรือเป้าหมายเดียวกันถ้าไม่ได้มาจากตารางเวลา) ใช้ตัดสินว่า "กลับมาผ่าน" */
    async previousFinished(batch: BatchRecord): Promise<BatchRecord | null> {
      const sameSource = batch.scheduleId != null ? eq(runBatches.scheduleId, batch.scheduleId) : and(eq(runBatches.projectId, batch.projectId), sql`${runBatches.target} = ${JSON.stringify(batch.target)}::jsonb`);
      const [row] = await db
        .select(batchColumns)
        .from(runBatches)
        .where(and(sameSource, lt(runBatches.id, batch.id), ne(runBatches.status, 'queued'), ne(runBatches.status, 'running')))
        .orderBy(desc(runBatches.id))
        .limit(1);
      return row ?? null;
    },
    /** งานที่ค้างสถานะกำลังรัน (runner ดับกลางทาง) ปิดเป็น error ตอนเริ่ม runner */
    async failStale(olderThanMs: number): Promise<number> {
      const rows = await db
        .update(runBatches)
        .set({ status: 'error', error: 'runner หยุดทำงานระหว่างรัน', finishedAt: sql`now()` })
        .where(and(eq(runBatches.status, 'running'), lt(runBatches.startedAt, new Date(Date.now() - olderThanMs))))
        .returning({ id: runBatches.id });
      return rows.length;
    },
  };
}
