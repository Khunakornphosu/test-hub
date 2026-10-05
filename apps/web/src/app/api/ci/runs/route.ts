import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertTarget, ciError, ciProject, publicOrigin } from '@/server/automation';
import { HttpError } from '@/server/route';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  /** ไม่ระบุ = ทั้งโปรเจกต์ */
  testId: z.number().int().positive().optional(),
  flowId: z.number().int().positive().optional(),
  /** ชื่อ environment ในโปรเจกต์ เช่น "staging" */
  environment: z.string().trim().min(1).max(40).optional(),
  label: z.string().trim().min(1).max(80).optional(),
}).refine((v) => !(v.testId && v.flowId), 'เลือก testId หรือ flowId อย่างใดอย่างหนึ่ง');

/**
 * สั่งรันจาก CI: curl -X POST $URL/api/ci/runs -H "Authorization: Bearer $TOKEN" -d '{"environment":"staging"}'
 * ได้ id กลับไปถามสถานะที่ GET /api/ci/runs/<id>
 */
export async function POST(req: Request) {
  try {
    const store = await getStore();
    const projectId = await ciProject(req, store);
    const text = await req.text();
    const input = requestSchema.parse(text.trim() ? JSON.parse(text) : {});
    const target = input.testId ? { type: 'test' as const, id: input.testId } : input.flowId ? { type: 'flow' as const, id: input.flowId } : { type: 'project' as const };
    const targetLabel = await assertTarget(store, projectId, target);
    const env = input.environment ? await store.repos.environments.findByName(projectId, input.environment) : null;
    if (input.environment && !env) throw new HttpError(400, `ไม่พบ environment "${input.environment}"`);
    const id = await store.repos.batches.enqueue({ projectId, target, trigger: 'api', label: input.label ?? `CI · ${targetLabel}`, environmentId: env?.id ?? null, environmentName: env?.name ?? null });
    const origin = publicOrigin(req);
    return NextResponse.json({ id, status: 'queued', statusUrl: `${origin}/api/ci/runs/${id}`, resultsUrl: `${origin}/runs?batch=${id}&project=all` }, { status: 202 });
  } catch (err) {
    return ciError(err);
  }
}
