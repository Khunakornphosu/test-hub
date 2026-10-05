import { environmentSchema } from '@test-studio/core';
import { body, HttpError, idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(async ({ req, params, store }) => {
  const env = await store.repos.environments.get(idParam(params.id));
  if (!env) throw notFound('environment');
  const value = await body(req, environmentSchema);
  const same = await store.repos.environments.findByName(env.projectId, value.name);
  if (same && same.id !== env.id) throw new HttpError(409, `มี environment ชื่อ "${value.name}" แล้ว`);
  await store.repos.environments.update(env.id, value);
});

export const DELETE = route<{ id: string }>(async ({ params, store }) => {
  await store.repos.environments.remove(idParam(params.id));
});
