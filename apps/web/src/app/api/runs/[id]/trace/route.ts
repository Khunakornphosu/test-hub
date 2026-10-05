import { idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

/** Playwright trace (zip) ของการรันที่พัง เปิดด้วย /trace-viewer/ */
export const GET = route<{ id: string }>(async ({ params, store }) => {
  const id = idParam(params.id, 'การรัน');
  const trace = await store.repos.runs.trace(id);
  if (!trace) throw notFound('trace ของการรันนี้ (เก็บเฉพาะการรันที่พัง 14 วันล่าสุด)');
  return new Response(new Uint8Array(trace), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="run-${id}-trace.zip"`, 'Cache-Control': 'private, max-age=3600' } });
});
