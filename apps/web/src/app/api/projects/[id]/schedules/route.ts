import { assertEnvironment, assertTarget, scheduleSchema, scheduleView } from '@/server/automation';
import { body, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';


export const GET = route<{ id: string }>(async ({ params, store }) => {
  const list = await store.repos.schedules.list(idParam(params.id, 'โปรเจกต์'));
  return Promise.all(list.map((s) => scheduleView(store, s)));
});

export const POST = route<{ id: string }>(async ({ req, params, store }) => {
  const projectId = idParam(params.id, 'โปรเจกต์');
  const input = await body(req, scheduleSchema);
  await assertTarget(store, projectId, input.target);
  await assertEnvironment(store, projectId, input.environmentId);
  return { id: await store.repos.schedules.create(projectId, input) };
});
