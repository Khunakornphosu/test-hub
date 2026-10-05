import postgres from 'postgres';

/** ล้างทุกตารางให้เหมือนฐานข้อมูลใหม่ (ทุกไฟล์เทสใช้ฐานข้อมูลเดียวกัน และ vitest เรียงลำดับไฟล์ไม่แน่นอน จึงต้องเริ่มจากว่างเสมอ) */
export async function resetDb(url = process.env.TEST_DATABASE_URL!): Promise<void> {
  const raw = postgres(url, { max: 1 });
  try {
    await raw.unsafe('truncate projects, tests, secrets, runs, run_traces, flows, environments, schedules, notification_channels, api_tokens, run_batches, backups restart identity cascade');
  } finally {
    await raw.end();
  }
}
