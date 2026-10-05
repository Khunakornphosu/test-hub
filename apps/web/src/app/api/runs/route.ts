import { route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req, store }) => {
  const url = new URL(req.url);
  const projectId = Number(url.searchParams.get('projectId')) || undefined;
  const testId = Number(url.searchParams.get('testId')) || undefined;
  const batchId = Number(url.searchParams.get('batchId')) || undefined;
  const status = url.searchParams.get('status');
  const passed = status === 'passed' ? true : status === 'failed' ? false : undefined;
  const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || 20, 100);
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  return store.repos.runs.listPage({ projectId, testId, batchId, passed, limit: pageSize, offset: (page - 1) * pageSize });
});
