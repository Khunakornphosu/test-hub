'use client';
import { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Select, useStyles2 } from '@grafana/ui';

export const PAGE_SIZES = [10, 20, 50, 100];

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label?: string;
}

/** แถบเปลี่ยนหน้าใต้ตาราง: จำนวนที่แสดง, เลือกจำนวนต่อหน้า และปุ่มเลขหน้า (ซ่อนถ้ามีไม่เกินหน้าเล็กสุด) */
export default function TablePager({ page, pageSize, total, onPage, onPageSize, label = 'รายการ' }: Props) {
  const s = useStyles2(styles);
  if (total <= PAGE_SIZES[0]!) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return <nav className={s.bar} aria-label="เปลี่ยนหน้า">
    <span className={s.count} role="status">แสดง {from.toLocaleString()}–{to.toLocaleString()} จาก {total.toLocaleString()} {label}</span>
    <div className={s.size}>
      <span>ต่อหน้า</span>
      <Select aria-label="จำนวนต่อหน้า" width={10} options={PAGE_SIZES.map((n) => ({ label: String(n), value: n }))} value={pageSize} onChange={(v) => v.value && onPageSize(v.value)} />
    </div>
    {pages > 1 && <div className={s.pages}>
      <IconButton name="angle-left" tooltip="หน้าก่อน" disabled={page <= 1} onClick={() => onPage(page - 1)} />
      {pageItems(page, pages).map((p, i) => p === 'gap'
        ? <span key={`gap-${i}`} className={s.gap} aria-hidden>…</span>
        : <Button key={p} size="sm" variant={p === page ? 'primary' : 'secondary'} fill={p === page ? 'solid' : 'text'} aria-current={p === page ? 'page' : undefined} aria-label={`หน้า ${p}`} onClick={() => onPage(p)}>{p}</Button>)}
      <IconButton name="angle-right" tooltip="หน้าถัดไป" disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </div>}
  </nav>;
}

/** เลขหน้าที่แสดง: หน้าแรก หน้าสุดท้าย และรอบๆ หน้าปัจจุบัน ที่เหลือย่อเป็น … */
export function pageItems(page: number, pages: number): (number | 'gap')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev === 2) out.push(p - 1);
    else if (p - prev > 2) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

/** แบ่งหน้าข้อมูลที่โหลดมาครบแล้วในเบราว์เซอร์ กลับไปหน้าสุดท้ายที่มีข้อมูลเองเมื่อรายการลดลง (เช่น หลังลบ) */
export function usePaged<T>(items: readonly T[], initialSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const current = Math.min(page, pages);
  const visible = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);
  return {
    visible,
    pager: { page: current, pageSize, total: items.length, onPage: setPage, onPageSize: (size: number) => { setPageSize(size); setPage(1); } },
  };
}

const styles = (t: GrafanaTheme2) => ({
  bar: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing(1.5), padding: t.spacing(1, 0), '> :last-child': { marginLeft: 'auto' } }),
  count: css({ color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
  pages: css({ display: 'flex', alignItems: 'center', gap: t.spacing(0.25) }),
  gap: css({ padding: t.spacing(0, 0.5), color: t.colors.text.secondary }),
  size: css({ display: 'flex', alignItems: 'center', gap: t.spacing(1), color: t.colors.text.secondary, fontSize: t.typography.bodySmall.fontSize }),
});
