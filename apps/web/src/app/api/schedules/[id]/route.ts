import { assertEnvironment, assertTarget, scheduleSchema } from '@/server/automation';
import { body, idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(async ({ req, params, store }) => {
  const schedule = await store.repos.schedules.get(idParam(params.id));
  if (!schedule) throw notFound('ตารางเวลา');
  const input = await body(req, scheduleSchema);
  await assertTarget(store, schedule.projectId, input.target);
  await assertEnvironment(store, schedule.projectId, input.environmentId);
  await store.repos.schedules.update(schedule.id, input);
});

export const DELETE = route<{ id: string }>(async ({ params, store }) => {
  await store.repos.schedules.remove(idParam(params.id));
});
