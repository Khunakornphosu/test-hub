import { idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const DELETE = route<{ id: string }>(async ({ params, store }) => {
  await store.repos.tokens.remove(idParam(params.id));
});
