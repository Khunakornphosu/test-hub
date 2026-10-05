import { assertEnvironment } from '@/server/automation';
import { idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

/** รันตารางเวลานี้ทันที (ไม่เปลี่ยนเวลารอบถัดไป) */
export const POST = route<{ id: string }>(async ({ params, store }) => {
  const s = await store.repos.schedules.get(idParam(params.id));
  if (!s) throw notFound('ตารางเวลา');
  const env = await assertEnvironment(store, s.projectId, s.environmentId);
  return { id: await store.repos.batches.enqueue({ projectId: s.projectId, target: s.target, trigger: 'manual', label: s.name, scheduleId: s.id, environmentId: env?.id ?? null, environmentName: env?.name ?? null }) };
});
