import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { flows, type FlowEdgeRecord, type FlowNodeRecord } from '../schema.js';

export interface FlowSummary { id: number; projectId: number; name: string; updatedAt: Date; nodeCount: number }
export interface FlowRecord extends FlowSummary { nodes: FlowNodeRecord[]; edges: FlowEdgeRecord[] }

export function flowsRepo(db: Db) {
  return {
    async list(projectId: number): Promise<FlowSummary[]> {
      return db.select({ id: flows.id, projectId: flows.projectId, name: flows.name, updatedAt: flows.updatedAt, nodeCount: sql<number>`jsonb_array_length(${flows.nodes})::int` })
        .from(flows).where(eq(flows.projectId, projectId)).orderBy(asc(flows.id));
    },
    async get(id: number): Promise<FlowRecord | null> {
      const [row] = await db.select({ id: flows.id, projectId: flows.projectId, name: flows.name, updatedAt: flows.updatedAt,
        nodeCount: sql<number>`jsonb_array_length(${flows.nodes})::int`, nodes: flows.nodes, edges: flows.edges })
        .from(flows).where(eq(flows.id, id));
      return row ?? null;
    },
    async create(projectId: number, name: string): Promise<number> {
      const [row] = await db.insert(flows).values({ projectId, name }).returning({ id: flows.id });
      return row!.id;
    },
    async update(id: number, value: { name?: string; nodes?: FlowNodeRecord[]; edges?: FlowEdgeRecord[] }): Promise<void> {
      await db.update(flows).set({ ...value, updatedAt: sql`now()` }).where(eq(flows.id, id));
    },
    async remove(id: number): Promise<void> { await db.delete(flows).where(eq(flows.id, id)); },
  };
}
