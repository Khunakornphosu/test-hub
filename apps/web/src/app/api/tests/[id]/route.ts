import { z } from 'zod';
import { body, idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => {
  const test = await store.repos.tests.get(idParam(params.id, 'เทสเคส'));
  if (!test) throw notFound('เทสเคสนี้');
  return { id: test.id, projectId: test.projectId, name: test.name, stepCount: test.steps.length, updatedAt: test.updatedAt };
});

export const PATCH = route<{ id: string }>(async ({ req, params, store }) => {
  const { name } = await body(req, z.object({ name: z.string().trim().min(1, 'กรุณาระบุชื่อ').max(120, 'ชื่อยาวเกินไป') }));
  const id = idParam(params.id, 'เทสเคส');
  if (!(await store.repos.tests.get(id))) throw notFound('เทสเคสนี้');
  await store.repos.tests.rename(id, name);
});

export const DELETE = route<{ id: string }>(async ({ params, store }) => {
  await store.repos.tests.remove(idParam(params.id, 'เทสเคส'));
});
