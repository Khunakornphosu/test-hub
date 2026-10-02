import { z } from 'zod';
import { body, route } from '@/server/route';

export const dynamic = 'force-dynamic';

const nameSchema = z.object({ name: z.string().trim().min(1, 'กรุณาระบุชื่อ').max(120, 'ชื่อยาวเกินไป') });

export const GET = route(async ({ store }) => store.repos.projects.list());

export const POST = route(async ({ req, store }) => {
  const { name } = await body(req, nameSchema);
  return { id: await store.repos.projects.create(name) };
});
