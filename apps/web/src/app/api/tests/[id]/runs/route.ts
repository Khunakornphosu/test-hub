import { idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params, store }) => store.repos.runs.list(idParam(params.id, 'เทสเคส')));
