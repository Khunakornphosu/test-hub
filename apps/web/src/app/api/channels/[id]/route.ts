import { z } from 'zod';
import { body, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(async ({ req, params, store }) => {
  const value = await body(req, z.object({ name: z.string().trim().min(1).max(80).optional(), notifyOn: z.enum(['problems', 'always']).optional(), enabled: z.boolean().optional() }));
  await store.repos.channels.update(idParam(params.id), value);
});

export const DELETE = route<{ id: string }>(async ({ params, store }) => {
  await store.repos.channels.remove(idParam(params.id));
});
