import { z } from 'zod';
import { HttpError, route } from '@/server/route';

export const dynamic = 'force-dynamic';

const MAX_RANGE_MS = 366 * 24 * 3600_000;
const query = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive().optional(),
});

/** สถิติ Dashboard ของช่วงเวลา from..to (ms) */
export const GET = route(async ({ req, store }) => {
  const url = new URL(req.url);
  const q = query.parse(Object.fromEntries(url.searchParams));
  if (q.to <= q.from) throw new HttpError(400, 'ช่วงเวลาไม่ถูกต้อง');
  if (q.to - q.from > MAX_RANGE_MS) throw new HttpError(400, 'ช่วงเวลายาวเกิน 1 ปี');
  return store.repos.stats.overview({ from: new Date(q.from), to: new Date(q.to), projectId: q.projectId });
});
