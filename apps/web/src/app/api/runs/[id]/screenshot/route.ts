import { idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => {
  const shot = await store.repos.runs.screenshot(idParam(params.id, 'การรัน'));
  if (!shot) throw notFound('screenshot');
  return new Response(new Uint8Array(shot), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
});
