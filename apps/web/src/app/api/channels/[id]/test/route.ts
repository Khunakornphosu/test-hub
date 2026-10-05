import { sendNotice } from '@test-studio/core';
import { urlGuard } from '@/server/automation';
import { HttpError, idParam, notFound, route } from '@/server/route';

export const dynamic = 'force-dynamic';

/** ส่งข้อความทดสอบไปที่ช่องทางนี้ เพื่อเช็กว่าตั้งค่าถูก */
export const POST = route<{ id: string }>(async ({ params, store }) => {
  const channel = await store.repos.channels.get(idParam(params.id));
  if (!channel) throw notFound('ช่องทางแจ้งเตือน');
  const project = await store.repos.projects.get(channel.projectId);
  try {
    await sendNotice(urlGuard(), channel.config, {
      projectName: project?.name ?? 'Test Studio', label: 'ข้อความทดสอบ', trigger: 'manual', total: 1, failed: 0, durationMs: 0, failures: [],
      error: 'นี่คือข้อความทดสอบจาก Test Studio ถ้าเห็นข้อความนี้แปลว่าตั้งค่าถูกต้องแล้ว',
    });
  } catch (err) {
    throw new HttpError(502, `ส่งไม่สำเร็จ: ${(err as Error).message}`);
  }
});
