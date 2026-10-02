import { NextResponse } from 'next/server';
import { sql } from '@test-studio/db';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

/** ตรวจว่าหน้าเว็บและฐานข้อมูลพร้อม (ไม่ต้องล็อกอิน ไม่เปิดเผยรายละเอียด) */
export async function GET() {
  try {
    await (await getStore()).db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
