'use client';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, ConfirmModal, Dropdown, Field, Icon, Input, Menu, Modal, useStyles2 } from '@grafana/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useProject } from '@/lib/project';

// สระหน้า (เ แ โ ใ ไ) อยู่หน้าพยัญชนะ จึงข้ามไปใช้ตัวอักษรแรกที่ไม่ใช่สระหน้า เช่น "โปรเจกต์" → "ป"
const initial = (name: string) => name.trim().match(/[^\s\u0E40-\u0E44]/u)?.[0]?.toUpperCase() ?? '?';

/** ตัวสลับโปรเจกต์บนสุดของเมนูซ้าย: เลือก สร้าง และลบโปรเจกต์ (ใช้ร่วมกันทุกหน้า) */
export default function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const s = useStyles2(styles);
  const qc = useQueryClient();
  const router = useRouter();
  const path = usePathname();
  const { projects, current, select, isLoading } = useProject();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // เทสที่เปิดอยู่ใน Workspace เป็นของโปรเจกต์เดิม สลับแล้วจึงกลับไปหน้ารายการเทส
  const leaveWorkspace = () => { if (path.startsWith('/workspace')) router.push('/tests'); };
  const choose = (id: number) => { if (id === current?.id) return; select(id); leaveWorkspace(); };
  const closeCreate = () => { setCreating(false); setName(''); setFormError(''); };

  const create = useMutation({
    mutationFn: (n: string) => api.createProject(n),
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: ['projects'] }); select(id); closeCreate(); leaveWorkspace(); },
    onError: (e: Error) => setFormError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteProject(id),
    onSuccess: () => { qc.invalidateQueries(); setConfirmDelete(false); leaveWorkspace(); },
  });

  const menu = <Menu>
    <Menu.Group label="โปรเจกต์">
      {projects.map((p) => <Menu.Item key={p.id} label={p.name} active={p.id === current?.id} onClick={() => choose(p.id)} />)}
    </Menu.Group>
    <Menu.Divider />
    <Menu.Item label="สร้างโปรเจกต์ใหม่" icon="plus" onClick={() => setCreating(true)} />
    {current && projects.length > 1 && <Menu.Item label={`ลบโปรเจกต์ "${current.name}"`} icon="trash-alt" destructive onClick={() => setConfirmDelete(true)} />}
  </Menu>;

  return <>
    <Dropdown overlay={menu} placement="bottom-start">
      <button type="button" className={cx(s.trigger, collapsed && s.collapsed)} aria-label={`โปรเจกต์: ${current?.name ?? 'ยังไม่มี'} (กดเพื่อสลับ)`} title={collapsed ? current?.name : undefined} disabled={isLoading}>
        <span className={s.badge} aria-hidden>{current ? initial(current.name) : '…'}</span>
        {!collapsed && <>
          <span className={s.text}><small>โปรเจกต์</small><b>{current?.name ?? (isLoading ? 'กำลังโหลด…' : 'ยังไม่มีโปรเจกต์')}</b></span>
          <Icon name="angle-down" className={s.caret} />
        </>}
      </button>
    </Dropdown>

    <Modal title="สร้างโปรเจกต์ใหม่" isOpen={creating} onDismiss={closeCreate}>
      <form onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return setFormError('กรุณาระบุชื่อ'); create.mutate(n); }}>
        <Field label="ชื่อ" invalid={!!formError} error={formError}>
          <Input autoFocus value={name} maxLength={120} placeholder="เช่น ระบบสมาชิก" onChange={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Modal.ButtonRow>
          <Button variant="secondary" fill="outline" type="button" onClick={closeCreate}>ยกเลิก</Button>
          <Button type="submit" disabled={create.isPending}>สร้าง</Button>
        </Modal.ButtonRow>
      </form>
    </Modal>
    <ConfirmModal isOpen={confirmDelete} title="ลบโปรเจกต์" body={`ลบ "${current?.name}" พร้อมเทส ประวัติ และ secret ทั้งหมด? ย้อนกลับไม่ได้`} confirmText="ลบ" onConfirm={() => { if (current) remove.mutate(current.id); }} onDismiss={() => setConfirmDelete(false)} />
  </>;
}

const styles = (t: GrafanaTheme2) => ({
  trigger: css({
    all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: t.spacing(1), width: `calc(100% - ${t.spacing(2)})`, margin: t.spacing(0, 1, 1), padding: t.spacing(0.75, 1),
    borderRadius: t.shape.radius.default, border: `1px solid ${t.colors.border.weak}`, background: t.colors.background.secondary, cursor: 'pointer', color: t.colors.text.primary,
    '&:hover': { borderColor: t.colors.border.medium, background: t.colors.action.hover },
    '&:focus-visible': { outline: `2px solid ${t.colors.primary.main}`, outlineOffset: 1 },
    '&:disabled': { cursor: 'default', opacity: 0.7 },
  }),
  collapsed: css({ justifyContent: 'center', padding: t.spacing(0.75, 0) }),
  badge: css({ flexShrink: 0, width: 24, height: 24, borderRadius: t.shape.radius.default, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: t.typography.fontWeightBold, background: t.colors.primary.main, color: t.colors.primary.contrastText }),
  text: css({ display: 'grid', minWidth: 0, flex: 1, lineHeight: 1.25, small: { color: t.colors.text.secondary, fontSize: 11 }, b: { fontWeight: t.typography.fontWeightMedium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
  caret: css({ flexShrink: 0, color: t.colors.text.secondary }),
});
