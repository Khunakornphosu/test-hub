// สำรองฐานข้อมูลเป็นไฟล์ .sql.gz (pg_dump แบบ plain SQL กู้คืนด้วย psql) และลบไฟล์เก่าเกินกำหนด
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { link, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { DEFAULT_TIMEZONE } from '@test-studio/core';

export interface BackupConfig {
  enabled: boolean;
  dir: string;
  /** สำรองวันละครั้งหลังเวลานี้ (ชั่วโมง เวลาไทย) */
  hour: number;
  keepDays: number;
  /** รัน pg_dump ในคอนเทนเนอร์ Postgres (เวอร์ชันตรงกับ server) แทน pg_dump ในเครื่อง */
  dockerContainer?: string;
}

const FILE = /^test-studio-\d{4}-\d{2}-\d{2}_\d{6}(-\d+)?\.sql\.gz$/;
const DUMP_FLAGS = ['--no-owner', '--no-privileges', '--clean', '--if-exists'];

function localParts(date: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), time: `${p.hour}${p.minute}${p.second}` };
}

/** ถึงเวลาสำรองวันนี้หรือยัง (ยังไม่มีไฟล์ที่สำเร็จของวันนี้ และเลยเวลาที่ตั้งไว้แล้ว) */
export function backupDue(now: Date, hour: number, lastSuccess: Date | null): boolean {
  const today = localParts(now);
  return today.hour >= hour && (!lastSuccess || localParts(lastSuccess).day !== today.day);
}

/** คำสั่ง pg_dump: ใช้ PG* environment แทนการใส่รหัสผ่านใน argument (คนอื่นในเครื่องเห็น argument ได้ด้วย ps) */
function dumpCommand(databaseUrl: string, dockerContainer?: string): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (dockerContainer) {
    // ภายในคอนเทนเนอร์ต่อผ่าน local socket ซึ่ง image ของ Postgres อนุญาตโดยไม่ต้องใช้รหัสผ่าน
    return { cmd: 'docker', args: ['exec', dockerContainer, 'pg_dump', '-U', user, '-d', database, ...DUMP_FLAGS], env: process.env };
  }
  return {
    cmd: 'pg_dump',
    args: DUMP_FLAGS,
    env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: user, PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database, PGSSLMODE: url.searchParams.get('sslmode') ?? process.env.PGSSLMODE },
  };
}

export async function createBackup(databaseUrl: string, config: Pick<BackupConfig, 'dir' | 'dockerContainer'>, now = new Date()): Promise<{ file: string; bytes: number }> {
  await mkdir(config.dir, { recursive: true });
  const t = localParts(now);
  // ไม่เขียนทับไฟล์เดิมเด็ดขาด (เช่น สำรองก่อนกู้คืนในวินาทีเดียวกัน)
  let file = path.join(config.dir, `test-studio-${t.day}_${t.time}.sql.gz`);
  for (let n = 2; await stat(file).then(() => true, () => false); n++) file = path.join(config.dir, `test-studio-${t.day}_${t.time}-${n}.sql.gz`);
  const tmp = `${file}.tmp`;
  const { cmd, args, env } = dumpCommand(databaseUrl, config.dockerContainer);
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 2000) stderr += chunk; });
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', (err) => reject(new Error(`เรียก ${cmd} ไม่ได้: ${err.message}`)));
    child.on('close', (code) => resolve(code ?? 1));
  });
  try {
    await pipeline(child.stdout, createGzip(), createWriteStream(tmp));
    const code = await exited;
    if (code !== 0) {
      const mismatch = /server version mismatch/i.test(stderr);
      throw new Error(mismatch
        ? `pg_dump ในเครื่องเก่ากว่า Postgres server — ตั้ง BACKUP_DOCKER_CONTAINER ให้ใช้ pg_dump ในคอนเทนเนอร์ หรือติดตั้ง pg_dump รุ่นเดียวกับ server (${stderr.trim().split('\n')[0]})`
        : `pg_dump ล้มเหลว (exit ${code}): ${stderr.trim().split('\n').slice(0, 3).join(' ') || 'ไม่มีรายละเอียด'}`);
    }
    await link(tmp, file); // ล้มเหลวถ้ามีไฟล์ชื่อนี้แล้ว ต่างจาก rename ที่เขียนทับ
    await rm(tmp, { force: true });
    return { file, bytes: (await stat(file)).size };
  } catch (err) {
    child.kill();
    await rm(tmp, { force: true });
    throw err;
  }
}

/** ลบไฟล์สำรองที่เก่ากว่า keepDays (เฉพาะไฟล์ที่ระบบสร้าง) */
export async function pruneBackups(dir: string, keepDays: number, now = Date.now()): Promise<string[]> {
  const removed: string[] = [];
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (!FILE.test(name)) continue;
    const full = path.join(dir, name);
    if (now - (await stat(full)).mtimeMs > keepDays * 86_400_000) {
      await rm(full, { force: true });
      removed.push(name);
    }
  }
  return removed;
}
