import { NextResponse } from 'next/server';
import { batchView, ciError, ciProject, publicOrigin } from '@/server/automation';
import { HttpError, idParam } from '@/server/route';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

/** สถานะของรอบที่ CI สั่ง: passed = null ระหว่างรอ/กำลังรัน */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const store = await getStore();
    const projectId = await ciProject(req, store);
    const batch = await store.repos.batches.get(idParam((await params).id, 'รอบการรัน'));
    if (!batch || batch.projectId !== projectId) throw new HttpError(404, 'ไม่พบรอบการรันนี้');
    const v = batchView(batch);
    return NextResponse.json({ id: v.id, status: v.status, passed: v.passed, total: v.total, failed: v.failed, error: v.error, environment: v.environmentName, resultsUrl: `${publicOrigin(req)}/runs?batch=${v.id}&project=all` });
  } catch (err) {
    return ciError(err);
  }
}
