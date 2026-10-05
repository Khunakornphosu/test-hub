'use client';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, useStyles2 } from '@grafana/ui';
import { useQuery } from '@tanstack/react-query';

interface BackupInfo { id: number; file: string | null; bytes: number | null; ok: boolean; error: string | null; createdAt: string }
const STALE_MS = 2 * 86_400_000;

/** สถานะการสำรองฐานข้อมูล (runner สำรองวันละครั้ง ไฟล์อยู่ในเครื่องที่รัน runner) */
export default function BackupSection() {
  const s = useStyles2(styles);
  const backups = useQuery({ queryKey: ['backups'], queryFn: async () => {
    const r = await fetch('/api/backups');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d as { lastSuccessAt: string | null; items: BackupInfo[] };
  } });
  const last = backups.data?.lastSuccessAt ? new Date(backups.data.lastSuccessAt) : null;
  const stale = !last || Date.now() - last.getTime() > STALE_MS;
  const latest = backups.data?.items[0];
  return <section className={s.section} aria-label="สำรองข้อมูล">
    <h2>สำรองข้อมูล</h2>
    <p className={s.muted}>runner สำรองฐานข้อมูลทั้งหมด (ทุกโปรเจกต์) วันละครั้งหลังตี 3 และเก็บไว้ 14 วัน · สำรองทันที: <code>npm run db:backup</code> · กู้คืน: <code>npm run db:restore -- &lt;ไฟล์&gt; --yes</code></p>
    {backups.isLoading ? null : stale ? (
      <Alert severity="warning" title={last ? `ไม่ได้สำรองข้อมูลมาตั้งแต่ ${last.toLocaleString('th-TH')}` : 'ยังไม่เคยสำรองข้อมูล'}>
        {latest && !latest.ok ? `ครั้งล่าสุดล้มเหลว: ${latest.error}` : 'ตรวจว่า runner เปิดอยู่ และตั้ง BACKUP_DIR ไว้ถูกต้อง'}
      </Alert>
    ) : (
      <Alert severity="success" title={`สำรองล่าสุด ${last!.toLocaleString('th-TH')}`} />
    )}
    {backups.data?.items.length ? <div className={s.tableWrap}><table className={s.table}><thead><tr><th>เวลา</th><th>ผล</th><th>ไฟล์</th><th>ขนาด</th></tr></thead><tbody>
      {backups.data.items.map((b) => <tr key={b.id} data-testid="backup-row">
        <td>{new Date(b.createdAt).toLocaleString('th-TH')}</td>
        <td>{b.ok ? <Badge color="green" text="สำเร็จ" /> : <Badge color="red" text="ล้มเหลว" tooltip={b.error ?? undefined} />}</td>
        <td className={s.muted}>{b.file ? <code>{b.file}</code> : b.error}</td>
        <td className={s.muted}>{b.bytes != null ? `${(b.bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB` : '—'}</td>
      </tr>)}
    </tbody></table></div> : null}
    <p className={s.hint}>ไฟล์สำรองมีตัวแปรลับแบบเข้ารหัส กู้คืนแล้วต้องใช้ SECRET_KEY เดิมจึงจะถอดรหัสได้ · ตั้ง BACKUP_DIR เป็นโฟลเดอร์ที่ sync ขึ้น Google Drive/iCloud เพื่อมีสำเนานอกเครื่อง</p>
  </section>;
}

const styles = (t: GrafanaTheme2) => ({
  section: css({ display: 'grid', gap: t.spacing(1.5), padding: t.spacing(2), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary, h2: { margin: 0 }, p: { margin: 0 } }),
  muted: css({ color: t.colors.text.secondary, code: { fontSize: 12 } }),
  hint: css({ color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
  tableWrap: css({ overflowX: 'auto', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
  table: css({ width: '100%', borderCollapse: 'collapse', 'th, td': { textAlign: 'left', padding: t.spacing(1, 1.5), borderBottom: `1px solid ${t.colors.border.weak}` }, th: { color: t.colors.text.secondary, fontWeight: 500, fontSize: t.typography.bodySmall.fontSize, background: t.colors.background.secondary }, 'tbody tr:last-child td': { borderBottom: 0 }, code: { fontSize: 12 } }),
});
