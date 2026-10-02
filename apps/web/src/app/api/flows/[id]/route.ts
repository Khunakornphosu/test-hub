import { z } from 'zod';
import { body, idParam, notFound, route } from '@/server/route';
import type { FlowEdgeRecord, FlowNodeRecord } from '@test-studio/db';

export const dynamic = 'force-dynamic';
const nodeSchema = z.object({
  id: z.string().min(1).max(80), type: z.literal('testCase'), testId: z.number().int().positive(),
  position: z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000) }),
});
const edgeSchema = z.object({ id: z.string().min(1).max(100), source: z.string().min(1).max(80), target: z.string().min(1).max(80), label: z.string().max(80).optional() });
const updateSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อ flow').max(120, 'ชื่อยาวเกินไป').optional(),
  nodes: z.array(nodeSchema).max(200).optional(),
  edges: z.array(edgeSchema).max(500).optional(),
}).refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่ต้องการบันทึก');

function validateGraph(nodes: FlowNodeRecord[], edges: FlowEdgeRecord[]) {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) return false;
  const edgeIds = new Set(edges.map((edge) => edge.id));
  if (edgeIds.size !== edges.length || edges.some((edge) => edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target))) return false;
  const outgoing = new Map<string, string[]>();
  const indegree = new Map([...ids].map((id) => [id, 0]));
  for (const edge of edges) { outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]); indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1); }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) { const id = queue.shift()!; visited++; for (const target of outgoing.get(id) ?? []) { const degree = indegree.get(target)! - 1; indegree.set(target, degree); if (!degree) queue.push(target); } }
  return visited === nodes.length;
}

export const GET = route<{ id: string }>(async ({ params, store }) => {
  const flow = await store.repos.flows.get(idParam(params.id, 'flow'));
  if (!flow) throw notFound('flow นี้');
  return flow;
});

export const PATCH = route<{ id: string }>(async ({ req, params, store }) => {
  const id = idParam(params.id, 'flow');
  const flow = await store.repos.flows.get(id);
  if (!flow) throw notFound('flow นี้');
  const update = await body(req, updateSchema);
  const nodes = update.nodes ?? flow.nodes;
  const edges = update.edges ?? flow.edges;
  if (!validateGraph(nodes, edges)) return Response.json({ error: 'เส้นทางมีวงวนหรือการเชื่อมต่อไม่ถูกต้อง' }, { status: 400 });
  if (update.nodes) {
    const tests = await Promise.all([...new Set(nodes.map((node) => node.testId))].map((testId) => store.repos.tests.get(testId)));
    if (tests.some((test) => !test || test.projectId !== flow.projectId)) return Response.json({ error: 'เทสเคสต้องอยู่ในโปรเจกต์เดียวกับ flow' }, { status: 400 });
  }
  await store.repos.flows.update(id, { ...update, nodes, edges });
});

export const DELETE = route<{ id: string }>(async ({ params, store }) => {
  await store.repos.flows.remove(idParam(params.id, 'flow'));
});
