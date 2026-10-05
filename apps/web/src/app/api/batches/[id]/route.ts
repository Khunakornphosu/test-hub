import { batchView } from '@/server/automation';
import { idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => {
  const batch = await store.repos.batches.get(idParam(params.id));
  if (!batch) throw notFound('รอบการรัน');
  return batchView(batch);
});
