import { idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

/** ส่งกลับเฉพาะชื่อ ไม่มีวันส่งค่าจริงออกไปหน้าเว็บ */
export const GET = route<{ id: string }>(async ({ params, store }) => store.repos.secrets.names(idParam(params.id, 'โปรเจกต์')));
