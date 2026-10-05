import { z } from 'zod';
import { runTargetSchema } from '@test-studio/core';
import { assertEnvironment, assertTarget, batchView } from '@/server/automation';
import { body, idParam, route } from '@/server/route';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ req, params, store }) => {
  const url = new URL(req.url);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || 10, 100);
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const { items, total } = await store.repos.batches.list(idParam(params.id, 'โปรเจกต์'), { limit: pageSize, offset: (page - 1) * pageSize });
  return { items: items.map(batchView), total };
});

/** สั่งรันทันทีจากหน้ารันอัตโนมัติ */
export const POST = route<{ id: string }>(async ({ req, params, store }) => {
  const projectId = idParam(params.id, 'โปรเจกต์');
  const input = await body(req, z.object({ target: runTargetSchema, environmentId: z.number().int().positive().nullable().default(null) }));
  const label = await assertTarget(store, projectId, input.target);
  const env = await assertEnvironment(store, projectId, input.environmentId);
  return { id: await store.repos.batches.enqueue({ projectId, target: input.target, trigger: 'manual', label: `สั่งรัน ${label}`, environmentId: env?.id ?? null, environmentName: env?.name ?? null }) };
});
