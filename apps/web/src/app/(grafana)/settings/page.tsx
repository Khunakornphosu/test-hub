'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input } from '@grafana/ui';
import { api } from '@/lib/api';
import { useProject } from '@/lib/project';

export default function Page() {
  const { projects, current, select, isLoading } = useProject();
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const reload = () => current && api.secrets(current.id).then(setNames).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, [current?.id]);
  const save = async () => { if (!current || !name.trim() || !value) return; try { await api.setSecret(current.id, name.trim().toUpperCase(), value); setName(''); setValue(''); setNotice('บันทึก secret แล้ว'); reload(); } catch (e) { setError((e as Error).message); } };
  const remove = async (n: string) => { if (!current) return; try { await api.deleteSecret(current.id, n); setNotice(`ลบ ${n} แล้ว`); reload(); } catch (e) { setError((e as Error).message); } };
  return <div style={{ padding: 24, maxWidth: 760, display: 'grid', gap: 16 }}><h1>ตั้งค่า</h1>{error && <Alert severity="error" title={error} onRemove={() => setError('')} />}{notice && <Alert severity="success" title={notice} onRemove={() => setNotice('')} />}
    <Field label="โปรเจกต์"><select value={current?.id ?? ''} onChange={(e) => select(Number(e.currentTarget.value))}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    {isLoading ? <span role="status">กำลังโหลดการตั้งค่า…</span> : current ? <><h2>ตัวแปรลับ (Secrets)</h2><p>ค่าเดิมจะไม่แสดงในหน้านี้</p><Field label="ชื่อ secret" description="ใช้ตัวพิมพ์ใหญ่ ตัวเลข และ _ เช่น TEST_EMAIL"><Input value={name} onChange={(e) => setName(e.currentTarget.value)} /></Field><Field label="ค่า"><Input type="password" autoComplete="new-password" value={value} onChange={(e) => setValue(e.currentTarget.value)} /></Field><Button variant="primary" icon="save" onClick={() => void save()}>บันทึก secret</Button>
      <h3>รายการ secret</h3>{names.length ? names.map((n) => <div key={n} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, borderBottom: '1px solid var(--border-weak)' }}><b>{n}</b><span>••••••••</span><Button size="sm" variant="destructive" icon="trash-alt" onClick={() => void remove(n)}>ลบ</Button></div>) : <p>ยังไม่มี secret</p>}</> : <p>ไม่พบโปรเจกต์</p>}
  </div>;
}
