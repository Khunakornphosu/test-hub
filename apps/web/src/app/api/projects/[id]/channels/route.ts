import { z } from 'zod';
import { channelConfigSchema } from '@test-studio/core';
import { body, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

const channelSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อ').max(80, 'ชื่อยาวเกินไป'),
  config: channelConfigSchema,
  notifyOn: z.enum(['problems', 'always']).default('problems'),
});

/** ไม่ส่ง webhook URL / token กลับไปหน้าเว็บ มีแค่ปลายทางแบบย่อ */
export const GET = route<{ id: string }>(async ({ params, store }) => store.repos.channels.list(idParam(params.id, 'โปรเจกต์')));

export const POST = route<{ id: string }>(async ({ req, params, store }) => {
  const input = await body(req, channelSchema);
  return { id: await store.repos.channels.create(idParam(params.id, 'โปรเจกต์'), input) };
});
