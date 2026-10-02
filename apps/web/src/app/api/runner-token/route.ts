import { signRunnerToken } from '@test-studio/core';
import { route } from '@/server/route';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

/**
 * ออก token อายุสั้น (60 วินาที) ให้ผู้ใช้ที่ล็อกอินแล้ว ใช้เปิด WebSocket กับ runner ครั้งเดียว
 * ไม่มี RUNNER_TOKEN_SECRET = runner รับเฉพาะเครื่องตัวเองและไม่ตรวจ token
 */
export const POST = route(async ({ user }) => {
  const env = getEnv();
  return { url: env.RUNNER_WS_URL, token: env.RUNNER_TOKEN_SECRET ? signRunnerToken(env.RUNNER_TOKEN_SECRET, user.email) : null };
});
