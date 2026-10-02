import { z } from 'zod';
import { body, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';
const nameSchema = z.object({ name: z.string().trim().min(1, 'กรุณาระบุชื่อ flow').max(120, 'ชื่อยาวเกินไป') });

export const GET = route<{ id: string }>(async ({ params, store }) => store.repos.flows.list(idParam(params.id, 'โปรเจกต์')));
export const POST = route<{ id: string }>(async ({ req, params, store }) => {
  const projectId = idParam(params.id, 'โปรเจกต์');
  const { name } = await body(req, nameSchema);
  return { id: await store.repos.flows.create(projectId, name) };
});
