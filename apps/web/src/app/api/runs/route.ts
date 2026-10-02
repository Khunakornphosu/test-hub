import { route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req, store }) => {
  const url = new URL(req.url);
  const projectId = Number(url.searchParams.get('projectId')) || undefined;
  const limit = Number(url.searchParams.get('limit')) || 50;
  return store.repos.runs.listRecent({ projectId, limit });
});
