import { z } from 'zod';
import { body, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => store.repos.tokens.list(idParam(params.id, 'โปรเจกต์')));

/** token จริงส่งกลับครั้งเดียวตอนสร้าง */
export const POST = route<{ id: string }>(async ({ req, params, store }) => {
  const { name } = await body(req, z.object({ name: z.string().trim().min(1, 'กรุณาตั้งชื่อ').max(80, 'ชื่อยาวเกินไป') }));
  return store.repos.tokens.create(idParam(params.id, 'โปรเจกต์'), name);
});
