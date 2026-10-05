'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, ConfirmModal, EmptyState, Field, Icon, IconButton, Input, LoadingPlaceholder, Modal, Select, useStyles2 } from '@grafana/ui';
import { api, type TestSummary } from '@/lib/api';
import { useProject } from '@/lib/project';

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export default function TestsPage() {
  const s = useStyles2(styles);
  const qc = useQueryClient();
  const router = useRouter();
  const { projects, current, select, isLoading: loadingProjects, error: projectsError } = useProject();
  const pid = current?.id;
  const tests = useQuery({ queryKey: ['tests', pid], queryFn: () => api.tests(pid!), enabled: pid != null });

  const [dialog, setDialog] = useState<null | { kind: 'test' | 'project' | 'rename'; id?: number; initial?: string }>(null);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<TestSummary | null>(null);
  const [deleteProject, setDeleteProject] = useState(false);
  const [formError, setFormError] = useState('');

  const close = () => { setDialog(null); setName(''); setFormError(''); };
  const onError = (e: Error) => setFormError(e.message);

  const createTest = useMutation({
    mutationFn: (n: string) => api.createTest(pid!, n),
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: ['tests'] }); router.push(`/workspace?test=${id}`); },
    onError,
  });
  const createProject = useMutation({
    mutationFn: (n: string) => api.createProject(n),
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: ['projects'] }); select(id); close(); },
    onError,
  });
  const rename = useMutation({
    mutationFn: (v: { id: number; name: string }) => api.renameTest(v.id, v.name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tests'] }); close(); },
    onError,
  });
  const removeTest = useMutation({
    mutationFn: (id: number) => api.deleteTest(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tests'] }); setToDelete(null); },
  });
  const removeProject = useMutation({
    mutationFn: (id: number) => api.deleteProject(id),
    onSuccess: () => { qc.invalidateQueries(); setDeleteProject(false); },
  });

  const submit = () => {
    const n = name.trim();
    if (!n) return setFormError('กรุณาระบุชื่อ');
    setFormError('');
    if (dialog?.kind === 'test') createTest.mutate(n);
    else if (dialog?.kind === 'project') createProject.mutate(n);
    else if (dialog?.kind === 'rename') rename.mutate({ id: dialog.id!, name: n });
  };
  const titles = { test: 'สร้างเทสเคสใหม่', project: 'สร้างโปรเจกต์ใหม่', rename: 'เปลี่ยนชื่อเทสเคส' };

  if (projectsError) return <div className={s.page}><Alert severity="error" title="โหลดโปรเจกต์ไม่ได้">{projectsError.message}</Alert></div>;
  if (loadingProjects) return <div className={s.page}><LoadingPlaceholder text="กำลังโหลด…" /></div>;

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h2 className={s.title}>เทสเคส</h2>
        <Select
          className={s.select}
          width={28}
          aria-label="โปรเจกต์"
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          value={pid}
          onChange={(v) => v.value != null && select(v.value)}
        />
        <IconButton name="plus" tooltip="สร้างโปรเจกต์" aria-label="สร้างโปรเจกต์" onClick={() => setDialog({ kind: 'project' })} />
        {current && projects.length > 1 && <IconButton name="trash-alt" tooltip="ลบโปรเจกต์นี้" aria-label="ลบโปรเจกต์นี้" onClick={() => setDeleteProject(true)} />}
        <div className={s.spacer} />
        <Button icon="plus" disabled={pid == null} onClick={() => setDialog({ kind: 'test' })}>สร้างเทสเคส</Button>
      </div>

      {tests.error && <Alert severity="error" title="โหลดเทสไม่ได้">{(tests.error as Error).message}</Alert>}
      {tests.isLoading && <LoadingPlaceholder text="กำลังโหลด…" />}
      {tests.data && tests.data.length === 0 && (
        <EmptyState variant="call-to-action" message="ยังไม่มีเทสเคสในโปรเจกต์นี้" button={<Button icon="plus" onClick={() => setDialog({ kind: 'test' })}>สร้างเทสเคสแรก</Button>}>
          สร้างแล้วเปิดหน้าเว็บ กดบันทึก คลิกไปตาม flow ระบบจะสร้าง step ให้
        </EmptyState>
      )}
      {tests.data && tests.data.length > 0 && (
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>ชื่อ</th><th>Steps</th><th>รันล่าสุด</th><th>แก้ไขเมื่อ</th><th aria-label="จัดการ" /></tr></thead>
          <tbody>
            {tests.data.map((t) => (
              <tr key={t.id} data-testid="test-row">
                <td><Link href={`/workspace?test=${t.id}`} className={s.link}>{t.name}</Link></td>
                <td>{t.stepCount}</td>
                <td>{t.lastPassed == null ? <Badge color="darkgrey" text="ยังไม่เคยรัน" /> : t.lastPassed ? <Badge color="green" icon="check-circle" text="ผ่าน" /> : <Badge color="red" icon="exclamation-triangle" text="ไม่ผ่าน" />}</td>
                <td className={s.muted}>{when(t.updatedAt)}</td>
                <td><div className={s.actions}>
                  <IconButton name="pen" tooltip="เปลี่ยนชื่อ" aria-label={`เปลี่ยนชื่อ ${t.name}`} onClick={() => { setName(t.name); setDialog({ kind: 'rename', id: t.id }); }} />
                  <IconButton name="trash-alt" tooltip="ลบ" aria-label={`ลบ ${t.name}`} onClick={() => setToDelete(t)} />
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <Modal title={dialog ? titles[dialog.kind] : ''} isOpen={dialog != null} onDismiss={close}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label="ชื่อ" invalid={!!formError} error={formError}>
            <Input autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} placeholder={dialog?.kind === 'project' ? 'เช่น ระบบสมาชิก' : 'เช่น Login ด้วยอีเมล'} />
          </Field>
          <Modal.ButtonRow>
            <Button variant="secondary" fill="outline" type="button" onClick={close}>ยกเลิก</Button>
            <Button type="submit" disabled={createTest.isPending || createProject.isPending || rename.isPending}>{dialog?.kind === 'rename' ? 'บันทึก' : 'สร้าง'}</Button>
          </Modal.ButtonRow>
        </form>
      </Modal>
      <ConfirmModal isOpen={!!toDelete} title="ลบเทสเคส" body={`ลบ "${toDelete?.name}" และประวัติการรันทั้งหมด? ย้อนกลับไม่ได้`} confirmText="ลบ" onConfirm={() => { if (toDelete) removeTest.mutate(toDelete.id); }} onDismiss={() => setToDelete(null)} />
      <ConfirmModal isOpen={deleteProject} title="ลบโปรเจกต์" body={`ลบ "${current?.name}" พร้อมเทส ประวัติ และ secret ทั้งหมด? ย้อนกลับไม่ได้`} confirmText="ลบ" onConfirm={() => { if (current) removeProject.mutate(current.id); }} onDismiss={() => setDeleteProject(false)} />
    </div>
  );
}

const styles = (t: GrafanaTheme2) => ({
  page: css({ boxSizing: 'border-box', width: '100%', padding: t.spacing(3), maxWidth: 1480, margin: '0 auto', '@media (max-width: 760px)': { padding: t.spacing(2) } }),
  head: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1.5), marginBottom: t.spacing(2), flexWrap: 'wrap' }),
  title: css({ margin: 0, marginRight: t.spacing(1) }),
  select: css({}),
  spacer: css({ flex: 1 }),
  table: css({ width: '100%', minWidth: 720, borderCollapse: 'collapse', 'th, td': { textAlign: 'left', padding: t.spacing(1.25, 1.5), borderBottom: `1px solid ${t.colors.border.weak}` }, th: { color: t.colors.text.secondary, fontWeight: 500, fontSize: t.typography.bodySmall.fontSize } }),
  tableWrap: css({ overflowX: 'auto', border: `1px solid ${t.colors.border.weak}`, borderRadius: t.shape.radius.default, 'table th:not(:last-child), table td:not(:last-child)': { borderRight: `1px solid ${t.colors.border.weak}` }, 'thead': { background: t.colors.background.secondary }, 'tbody tr:last-child td': { borderBottom: 0 }, 'tbody tr:hover': { background: t.colors.action.hover } }),
  link: css({ color: t.colors.text.link, fontWeight: 500 }),
  muted: css({ color: t.colors.text.secondary }),
  actions: css({ display: 'flex', gap: t.spacing(1), justifyContent: 'flex-end' }),
});
