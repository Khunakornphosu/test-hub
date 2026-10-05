import { environmentSchema } from '@test-studio/core';
import { body, HttpError, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => store.repos.environments.list(idParam(params.id, 'โปรเจกต์')));

export const POST = route<{ id: string }>(async ({ req, params, store }) => {
  const projectId = idParam(params.id, 'โปรเจกต์');
  const value = await body(req, environmentSchema);
  if (await store.repos.environments.findByName(projectId, value.name)) throw new HttpError(409, `มี environment ชื่อ "${value.name}" แล้ว`);
  return { id: await store.repos.environments.create(projectId, value) };
});
