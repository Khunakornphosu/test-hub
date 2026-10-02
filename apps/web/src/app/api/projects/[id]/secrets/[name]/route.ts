import { z } from 'zod';
import { SECRET_NAME } from '@test-studio/core/client';
import { body, HttpError, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

const nameOf = (raw: string) => {
  const name = decodeURIComponent(raw).toUpperCase();
  if (!SECRET_NAME.test(name)) throw new HttpError(400, 'ชื่อตัวแปรใช้ได้เฉพาะ A-Z, 0-9 และ _');
  return name;
};

export const PUT = route<{ id: string; name: string }>(async ({ req, params, store }) => {
  const { value } = await body(req, z.object({ value: z.string().max(10_000, 'ค่ายาวเกินไป') }));
  await store.repos.secrets.set(idParam(params.id, 'โปรเจกต์'), nameOf(params.name), value);
});

export const DELETE = route<{ id: string; name: string }>(async ({ params, store }) => {
  await store.repos.secrets.remove(idParam(params.id, 'โปรเจกต์'), nameOf(params.name));
});
