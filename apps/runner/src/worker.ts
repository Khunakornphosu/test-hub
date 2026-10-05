// รันอัตโนมัติเบื้องหลัง: เอาตารางเวลาที่ถึงเวลาเข้าคิว แล้วหยิบรอบการรันจากคิวมารันทีละรอบ (ไม่ต้องมีคนเปิด Workspace)
import {
  FAILURE_CATEGORIES,
  MAX_FLOW_PATHS,
  classifyFailure,
  describeStep,
  VIEWPORT,
  flowPaths,
  rebaseUrl,
  sendNotice,
  shouldNotify,
  type BatchNotice,
  type ChannelConfig,
  type UrlGuard,
} from '@test-studio/core';
import type { BatchRecord, Store } from '@test-studio/db';
import type { Browser } from 'playwright';
import { runSteps, type ExecContext, type StepWithId } from './executor.js';
import { analyzeFailure, startTrace, stopTrace } from './insights.js';
import { backupDue, createBackup, pruneBackups, type BackupConfig } from './backup.js';

/** รอบที่ค้างสถานะ "กำลังรัน" นานเกินนี้ถือว่า runner ดับไปแล้ว */
const STALE_MS = 2 * 60 * 60_000;

export interface WorkerOptions {
  store: Store;
  browser: Browser;
  urlGuard: UrlGuard;
  pollMs: number;
  /** จำนวนครั้งที่รันซ้ำเมื่อพัง (0 = ไม่รันซ้ำ) */
  retries?: number;
  /** สำรองฐานข้อมูลวันละครั้ง (ไม่ระบุ = ไม่สำรอง) */
  backup?: BackupConfig & { databaseUrl: string };
  /** URL ของหน้าเว็บ ใช้ทำลิงก์ในแจ้งเตือน */
  publicAppUrl?: string;
  /** เปลี่ยนตัวส่งแจ้งเตือนได้ (เทส) */
  notify?: (config: ChannelConfig, notice: BatchNotice) => Promise<void>;
  log?: (message: string) => void;
}

export interface Worker {
  /** ทำงานหนึ่งรอบทันที (ใส่คิว + รันจนคิวว่าง) */
  tick(): Promise<void>;
  stop(): Promise<void>;
}

class BatchError extends Error {}

export function startWorker(options: WorkerOptions): Worker {
  const { store, browser, urlGuard } = options;
  const log = options.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const notify = options.notify ?? ((config, notice) => sendNotice(urlGuard, config, notice));
  const retries = options.retries ?? 1;
  let busy: Promise<void> | null = null;
  let stopping = false;

  const checkUrl = async (url: string) => {
    const verdict = await urlGuard.check(url);
    if (!verdict.ok) throw new Error(verdict.reason);
  };

  /** แผนการรัน: แต่ละเส้นทางคือรายการเทสที่รันต่อกัน (โปรเจกต์/เทสเดียว = เส้นทางละ 1 เทส) */
  async function plan(batch: BatchRecord): Promise<number[][]> {
    const target = batch.target;
    if (target.type === 'project') {
      const list = await store.repos.tests.list(batch.projectId);
      const runnable = list.filter((t) => t.stepCount > 0);
      if (!runnable.length) throw new BatchError('ไม่มีเทสที่มี step ในโปรเจกต์นี้');
      return runnable.map((t) => [t.id]);
    }
    if (target.type === 'test') {
      const test = await store.repos.tests.get(target.id);
      if (!test || test.projectId !== batch.projectId) throw new BatchError('ไม่พบเทสที่ตั้งไว้ (อาจถูกลบไปแล้ว)');
      return [[test.id]];
    }
    const flow = await store.repos.flows.get(target.id);
    if (!flow || flow.projectId !== batch.projectId) throw new BatchError('ไม่พบ Flow ที่ตั้งไว้ (อาจถูกลบไปแล้ว)');
    const paths = flowPaths(flow.nodes, flow.edges);
    if (!paths.length) throw new BatchError(`Flow "${flow.name}" ยังไม่มีเทส`);
    if (paths.length > MAX_FLOW_PATHS) throw new BatchError(`Flow "${flow.name}" มีเส้นทางมากกว่า ${MAX_FLOW_PATHS} เส้น กรุณาแบ่ง Flow ก่อน`);
    const testOf = new Map(flow.nodes.map((n) => [n.id, n.testId]));
    return paths.map((path) => path.map((nodeId) => testOf.get(nodeId)!));
  }

  /** รันเทสหนึ่งครั้งใน browser context ใหม่ (เหมือนกดรันใน Workspace) พร้อม trace เมื่อพัง */
  async function runOnce(testId: number, steps: StepWithId[], ctx: ExecContext) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      await context.addInitScript('window.__name = window.__name || ((fn) => fn);');
      await startTrace(context).catch(() => {});
      const page = await context.newPage();
      const outcome = await runSteps(page, store, testId, steps, ctx, { step: () => {} });
      return { outcome, trace: await stopTrace(context, !outcome.passed) };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function runBatch(batch: BatchRecord): Promise<void> {
    const started = Date.now();
    const project = await store.repos.projects.get(batch.projectId);
    let total = 0;
    let failed = 0;
    let error: string | null = null;
    const failures: BatchNotice['failures'] = [];
    const flakyTests: string[] = [];
    log(`เริ่มรอบ #${batch.id} "${batch.label}"`);
    try {
      const env = batch.environmentId ? await store.repos.environments.get(batch.environmentId) : null;
      if (batch.environmentName && !env) throw new BatchError(`ไม่พบ environment "${batch.environmentName}" (อาจถูกลบไปแล้ว)`);
      const paths = await plan(batch);
      const secrets = await store.repos.secrets.values(batch.projectId);
      const summaries = await store.repos.tests.list(batch.projectId);
      const byId = new Map(summaries.map((t) => [t.id, t]));
      const ctx = {
        testName: (id: number) => byId.get(id)?.name,
        testStepCount: (id: number) => byId.get(id)?.stepCount,
        secrets,
        checkUrl,
        resolveUrl: env ? (url: string) => rebaseUrl(url, env.baseUrl) : undefined,
      };

      for (const path of paths) {
        for (const testId of path) {
          if (stopping) throw new BatchError('runner ถูกปิดระหว่างรัน');
          const test = await store.repos.tests.get(testId);
          if (!test) {
            total++;
            failed++;
            failures.push({ testName: `เทส #${testId}`, error: 'ไม่พบเทส (อาจถูกลบไปแล้ว)' });
            break;
          }
          const steps = test.steps.map((s, i) => ({ ...s, id: s.id ?? i + 1 })) as StepWithId[];
          // พังแล้วลองใหม่ (context ใหม่) ถ้าครั้งหลังผ่านถือว่า "ไม่เสถียร" ไม่ใช่ไม่ผ่าน
          let attempt = await runOnce(test.id, steps, ctx);
          const first = attempt;
          for (let retry = 0; !attempt.outcome.passed && retry < retries && !stopping; retry++) attempt = await runOnce(test.id, steps, ctx);
          const isFlaky = !first.outcome.passed && attempt.outcome.passed;
          const failedAttempt = attempt.outcome.passed ? (isFlaky ? first : null) : attempt;
          const firstError = first.outcome.failure?.error ?? null;
          const analysis = !attempt.outcome.passed
            ? await analyzeFailure(attempt.outcome, test.name, steps.map((st) => describeStep(st, ctx)))
            : isFlaky && firstError ? classifyFailure(firstError) : null;
          const runId = await store.repos.runs.create({
            testId: test.id,
            batchId: batch.id,
            startedAt: first.outcome.startedAt,
            durationMs: attempt.outcome.durationMs,
            passed: attempt.outcome.passed,
            results: attempt.outcome.results,
            screenshot: failedAttempt?.outcome.screenshot ?? null,
            flaky: isFlaky,
            retryError: isFlaky ? firstError : null,
            analysis,
          });
          if (failedAttempt?.trace) await store.repos.runs.saveTrace(runId, failedAttempt.trace);
          total++;
          const passed = attempt.outcome.passed;
          if (isFlaky) flakyTests.push(test.name);
          if (!passed) {
            failed++;
            failures.push({ testName: test.name, error: attempt.outcome.failure?.error ?? 'ไม่ผ่าน', hint: analysis ? (analysis.source === 'ai' ? analysis.summary : FAILURE_CATEGORIES[analysis.category]) : undefined });
          }
          await store.repos.batches.progress(batch.id, { total, failed, flaky: flakyTests.length });
          // ไม่ผ่าน: เทสที่เหลือในเส้นทางเดียวกันข้าม (ตามกติกาของ Flow)
          if (!passed) break;
        }
      }
    } catch (err) {
      error = err instanceof BatchError ? err.message : `เกิดข้อผิดพลาด: ${(err as Error).message}`;
      if (!(err instanceof BatchError)) console.error(`[worker] รอบ #${batch.id}`, err);
    }

    await store.repos.batches.finish(batch.id, { total, failed, flaky: flakyTests.length, error });
    log(`จบรอบ #${batch.id}: ${error ?? `ผ่าน ${total - failed}/${total}`}`);
    await sendNotifications(batch, { total, failed, error, failures, flaky: flakyTests, durationMs: Date.now() - started, projectName: project?.name ?? `โปรเจกต์ #${batch.projectId}` });
  }

  async function sendNotifications(batch: BatchRecord, result: { total: number; failed: number; error: string | null; failures: BatchNotice['failures']; flaky: string[]; durationMs: number; projectName: string }) {
    const channels = await store.repos.channels.enabledFor(batch.projectId);
    if (!channels.length) return;
    const previous = await store.repos.batches.previousFinished(batch);
    const previousPassed = previous ? previous.status === 'done' && previous.failed === 0 : null;
    const passed = !result.error && result.failed === 0;
    const notice: BatchNotice = {
      projectName: result.projectName,
      label: batch.label,
      trigger: batch.trigger,
      environmentName: batch.environmentName,
      total: result.total,
      failed: result.failed,
      durationMs: result.durationMs,
      recovered: passed && previousPassed === false,
      error: result.error,
      failures: result.failures,
      flaky: result.flaky,
      url: options.publicAppUrl ? `${options.publicAppUrl.replace(/\/$/, '')}/runs?batch=${batch.id}&project=all` : null,
    };
    for (const channel of channels) {
      if (!shouldNotify(channel.notifyOn, passed, previousPassed)) continue;
      try {
        await notify(channel.config, notice);
      } catch (err) {
        log(`ส่งแจ้งเตือน "${channel.name}" ไม่สำเร็จ: ${(err as Error).message}`);
      }
    }
  }

  /** ถึงเวลาแล้วสำรองฐานข้อมูล (ล้มเหลวแล้วรอ 1 ชั่วโมงก่อนลองใหม่ ไม่ให้รัวทุกรอบ) */
  async function maybeBackup(): Promise<void> {
    const backup = options.backup;
    if (!backup?.enabled) return;
    const [last] = await store.repos.backups.recent(1);
    if (last && !last.ok && Date.now() - last.createdAt.getTime() < 60 * 60_000) return;
    if (!backupDue(new Date(), backup.hour, (await store.repos.backups.lastSuccess())?.createdAt ?? null)) return;
    await store.repos.backups.exclusive(async () => {
      if (!backupDue(new Date(), backup.hour, (await store.repos.backups.lastSuccess())?.createdAt ?? null)) return;
      const started = Date.now();
      try {
        const { file, bytes } = await createBackup(backup.databaseUrl, backup);
        await store.repos.backups.record({ file, bytes, ok: true, error: null, durationMs: Date.now() - started });
        const removed = await pruneBackups(backup.dir, backup.keepDays);
        log(`สำรองฐานข้อมูลแล้ว: ${file} (${Math.round(bytes / 1024)} KB)${removed.length ? ` · ลบไฟล์เก่า ${removed.length} ไฟล์` : ''}`);
      } catch (err) {
        await store.repos.backups.record({ file: null, bytes: null, ok: false, error: (err as Error).message.slice(0, 500), durationMs: Date.now() - started });
        log(`สำรองฐานข้อมูลไม่สำเร็จ: ${(err as Error).message}`);
      }
    });
  }

  async function work(): Promise<void> {
    await maybeBackup();
    await store.repos.batches.failStale(STALE_MS);
    await store.repos.runs.pruneTraces({ maxAgeDays: 14, keep: 500 });
    await store.repos.schedules.enqueueDue();
    for (let batch = await store.repos.batches.claimNext(); batch && !stopping; batch = await store.repos.batches.claimNext()) {
      await runBatch(batch);
    }
  }

  const tick = () => {
    // ไม่ให้รอบทับกัน: ถ้ายังทำงานอยู่ก็รอรอบเดิม
    busy ??= work()
      .catch((err) => console.error('[worker]', err))
      .finally(() => { busy = null; });
    return busy;
  };
  const timer = setInterval(() => void tick(), options.pollMs);
  void tick();

  return {
    tick,
    async stop() {
      stopping = true;
      clearInterval(timer);
      await busy;
    },
  };
}
