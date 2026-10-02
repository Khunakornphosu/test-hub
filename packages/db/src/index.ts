import { createCipher, type Cipher } from '@test-studio/core';
import { createDb, type Db, type DbHandle } from './client.js';
import { projectsRepo } from './repos/projects.js';
import { runsRepo } from './repos/runs.js';
import { secretsRepo } from './repos/secrets.js';
import { testsRepo } from './repos/tests.js';

export * from './schema.js';
export * from './client.js';
export * from './migrate.js';
export { importPoc, type ImportReport } from './import-poc.js';
export type { Project } from './repos/projects.js';
export type { TestRecord, TestSummary } from './repos/tests.js';
export type { NewRun, RunDetail, RunSummary } from './repos/runs.js';

export function createRepos(db: Db, cipher: Cipher) {
  return { projects: projectsRepo(db), tests: testsRepo(db), secrets: secretsRepo(db, cipher), runs: runsRepo(db) };
}
export type Repos = ReturnType<typeof createRepos>;

export interface Store extends DbHandle {
  repos: Repos;
  cipher: Cipher;
}

/**
 * เปิดการเชื่อมต่อพร้อม repository ทั้งหมด
 * cipher ถ้าไม่ระบุ ใช้ SECRET_KEY จาก environment (ต้องมี ไม่งั้นตัวแปรลับจะถอดรหัสไม่ได้ข้ามการรีสตาร์ท)
 */
export function openStore(options: { url?: string; cipher?: Cipher; max?: number } = {}): Store {
  const handle = createDb(options.url, { max: options.max });
  const cipher = options.cipher ?? createCipher(null);
  return { ...handle, repos: createRepos(handle.db, cipher), cipher };
}

/** ใส่โปรเจกต์และเทสตัวอย่างถ้ายังไม่มีข้อมูล (ใช้ตอนพัฒนา/ทดลอง) */
export async function seedIfEmpty(repos: Repos): Promise<void> {
  if ((await repos.projects.list()).length) return;
  const projectId = await repos.projects.create('โปรเจกต์ตัวอย่าง');
  await repos.tests.create(projectId, 'Login Test');
}
