'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Field, Input, useStyles2 } from '@grafana/ui';

const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/');

export default function LoginPage() {
  const s = useStyles2(styles);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState('/');
  useEffect(() => setNext(safeNext(new URLSearchParams(location.search).get('next'))), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (res.ok) return void location.replace(next);
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
      setPassword('');
    } catch {
      setError('เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  return <main className={s.page}>
    <form className={s.card} onSubmit={submit}>
      <div className={s.brand}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.2L4.6 18.1A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.9L14 9.2V3" /><path d="M7.5 15h9" /></svg>
        <span>Test Studio</span>
      </div>
      <h1>เข้าสู่ระบบ</h1>
      <p className={s.hint}>ใส่รหัสผ่านของทีมที่ได้รับมา</p>
      {error && <Alert severity="error" title={error} />}
      <Field label="รหัสผ่านทีม">
        <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
      </Field>
      <Button type="submit" fullWidth disabled={!password || busy}>{busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}</Button>
    </form>
  </main>;
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: t.spacing(2), background: t.colors.background.canvas }),
  card: css({ width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', gap: t.spacing(1.5), padding: t.spacing(4), border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, background: t.colors.background.primary, boxShadow: t.shadows.z2, h1: { margin: 0, fontSize: t.typography.h3.fontSize } }),
  brand: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1), color: t.colors.warning.main, fontWeight: t.typography.fontWeightMedium, fontSize: t.typography.h5.fontSize, span: { color: t.colors.text.primary } }),
  hint: css({ margin: 0, color: t.colors.text.secondary }),
});
