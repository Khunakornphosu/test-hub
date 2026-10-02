import { idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => {
  const run = await store.repos.runs.get(idParam(params.id, 'การรัน'));
  if (!run) throw notFound('การรันนี้');
  const test = await store.repos.tests.get(run.testId);
  return { ...run, testName: test?.name ?? '(เทสถูกลบแล้ว)', projectId: test?.projectId ?? null };
});
