import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  /** ปิดการเชื่อมต่อทั้งหมด */
  close(): Promise<void>;
}

export const DEFAULT_DATABASE_URL = 'postgres://test_studio:test_studio@127.0.0.1:5433/test_studio';

export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, options: { max?: number } = {}): DbHandle {
  // prepare:false ใช้ได้กับ connection pooler ของ cloud (เช่น Neon pooled) ด้วย
  const client = postgres(url, { max: options.max ?? 5, prepare: false, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
