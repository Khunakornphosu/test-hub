'use client';
import { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Field, Input, useStyles2 } from '@grafana/ui';
import BackupSection from '@/components/g/BackupSection';
import TablePager, { usePaged } from '@/components/g/TablePager';
import { api } from '@/lib/api';
import { useProject } from '@/lib/project';

export default function Page() {
  const s = useStyles2(styles);
  const { current, isLoading } = useProject();
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const reload = () => current && api.secrets(current.id).then(setNames).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, [current?.id]);
  const save = async () => { if (!current || !name.trim() || !value) return; try { await api.setSecret(current.id, name.trim().toUpperCase(), value); setName(''); setValue(''); setNotice('บันทึก secret แล้ว'); reload(); } catch (e) { setError((e as Error).message); } };
  const pagedNames = usePaged(names);
  const remove = async (n: string) => { if (!current) return; try { await api.deleteSecret(current.id, n); setNotice(`ลบ ${n} แล้ว`); reload(); } catch (e) { setError((e as Error).message); } };
  return <div className={s.page}><header className={s.header}><h1>ตั้งค่า</h1><p>{current ? <>โปรเจกต์ <b>{current.name}</b> · </> : null}จัดการตัวแปรลับที่ใช้ในเทส โดยค่าที่บันทึกไว้จะไม่แสดงบนหน้านี้</p></header>{error && <Alert severity="error" title={error} onRemove={() => setError('')} />}{notice && <Alert severity="success" title={notice} onRemove={() => setNotice('')} />}
    {isLoading ? <span role="status">กำลังโหลดการตั้งค่า…</span> : current ? <section className={s.section}><div className={s.sectionHead}><div><h2>ตัวแปรลับ</h2><p>เก็บค่าที่ใช้ในขั้นตอนทดสอบ เช่น อีเมลหรือรหัสผ่าน</p></div></div><div className={s.form}><Field label="ชื่อ secret" description="ใช้ตัวพิมพ์ใหญ่ ตัวเลข และ _ เช่น TEST_EMAIL"><Input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="เช่น TEST_EMAIL" /></Field><Field label="ค่า"><Input type="password" autoComplete="new-password" value={value} onChange={(e) => setValue(e.currentTarget.value)} placeholder="กรอกค่าที่ต้องการเก็บ" /></Field><Button className={s.save} variant="primary" icon="save" disabled={!name.trim() || !value} onClick={() => void save()}>บันทึก secret</Button></div>
      <div className={s.listHead}><h3>รายการ secret</h3><span>{names.length} รายการ</span></div>{names.length ? <div className={s.secretTableWrap}><table className={s.secretTable}><thead><tr><th>ชื่อ</th><th>ค่าที่เก็บ</th><th>จัดการ</th></tr></thead><tbody>{pagedNames.visible.map((n) => <tr key={n}><td><b>{n}</b></td><td><span aria-label="ซ่อนค่า secret">••••••••</span></td><td><Button size="sm" variant="secondary" icon="trash-alt" onClick={() => void remove(n)}>ลบ</Button></td></tr>)}</tbody></table><TablePager {...pagedNames.pager} label="secret" /></div> : <p className={s.empty}>ยังไม่มี secret ในโปรเจกต์นี้</p>}</section> : <p>ไม่พบโปรเจกต์</p>}
    <BackupSection />
  </div>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ boxSizing: 'border-box', width: '100%', padding: t.spacing(3), maxWidth: 1120, display: 'grid', gap: t.spacing(2.5), margin: '0 auto', '@media (max-width: 760px)': { padding: t.spacing(2) } }),
  header: css({ h1: { margin: 0 }, p: { margin: `${t.spacing(0.5)} 0 0`, color: t.colors.text.secondary } }),
  section: css({ padding: t.spacing(2), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary }),
  sectionHead: css({ marginBottom: t.spacing(2), h2: { margin: 0 }, p: { margin: `${t.spacing(0.5)} 0 0`, color: t.colors.text.secondary } }),
  form: css({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: t.spacing(2), alignItems: 'end', '@media (max-width: 760px)': { gridTemplateColumns: 'minmax(0, 1fr)' } }),
  save: css({ gridColumn: '1 / -1', justifySelf: 'start', '@media (max-width: 760px)': { gridColumn: 'auto' } }),
  listHead: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: t.spacing(3), h3: { margin: 0 }, span: { color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize } }),
  secretTableWrap: css({ marginTop: t.spacing(1), overflowX: 'auto', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default }),
  secretTable: css({ width: '100%', borderCollapse: 'collapse', 'th, td': { textAlign: 'left', padding: t.spacing(1.25, 1.5), borderBottom: `1px solid ${t.colors.border.weak}`, borderRight: `1px solid ${t.colors.border.weak}` }, 'th:last-child, td:last-child': { borderRight: 0 }, th: { color: t.colors.text.secondary, fontWeight: 500, fontSize: t.typography.bodySmall.fontSize, background: t.colors.background.secondary }, 'tbody tr:last-child td': { borderBottom: 0 }, 'tbody tr:hover': { background: t.colors.action.hover }, 'td:nth-child(2)': { color: t.colors.text.secondary, letterSpacing: 1 }, 'td:last-child': { width: 100 } }),
  empty: css({ color: t.colors.text.secondary, padding: t.spacing(1, 0) }),
});
