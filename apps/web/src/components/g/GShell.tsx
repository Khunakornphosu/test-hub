'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Input, useStyles2, type IconName } from '@grafana/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useGMode } from './GProviders';

const NAV: { href: string; label: string; icon: IconName; section?: string }[] = [
  { href: '/', label: 'ภาพรวม', icon: 'apps' },
  { href: '/tests', label: 'เทสเคส', icon: 'list-ul' },
  { href: '/flows', label: 'Test Flow', icon: 'sitemap' },
  { href: '/workspace', label: 'Workspace', icon: 'edit' },
  { href: '/runs', label: 'ผลการรัน', icon: 'history' },
  { href: '/settings', label: 'ตั้งค่า', icon: 'cog', section: 'ผู้ดูแล' },
];

const crumbs: Record<string, string[]> = {
  '/': ['ภาพรวม'],
  '/tests': ['เทสเคส'],
  '/flows': ['Test Flow'],
  '/workspace': ['เทสเคส', 'Workspace'],
  '/runs': ['ผลการรัน'],
  '/settings': ['ผู้ดูแล', 'ตั้งค่า'],
};

export default function GShell({ children }: { children: ReactNode }) {
  const s = useStyles2(styles);
  const path = usePathname();
  const { mode, toggle } = useGMode();
  // เมนูซ้ายย่อได้ (เหลือแต่ไอคอน) จำสถานะไว้ในเครื่อง
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const sync = () => {
      const compact = window.matchMedia('(max-width: 760px)').matches;
      try { setCollapsed(compact || localStorage.getItem('ts-menu') === 'collapsed'); } catch { setCollapsed(compact); }
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  const toggleMenu = () => setCollapsed((c) => {
    try { localStorage.setItem('ts-menu', c ? 'open' : 'collapsed'); } catch {}
    return !c;
  });
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <div className={s.root} style={{ gridTemplateColumns: `${collapsed ? 56 : 220}px minmax(0, 1fr)` }}>
      <header className={s.top}>
        <Link href="/" className={s.logo} style={{ width: collapsed ? 56 : 220 }} aria-label="Test Studio">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.2L4.6 18.1A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.9L14 9.2V3" /><path d="M7.5 15h9" /></svg>
          {!collapsed && <span className={s.brand}>Test Studio</span>}
        </Link>
        <nav className={s.crumbs} aria-label="เส้นทาง">
          <Link href="/">Home</Link>
          {(crumbs[path] ?? []).map((c, i, a) => (
            <span key={i} className={s.crumb}><Icon name="angle-right" size="sm" /><span className={i === a.length - 1 ? s.crumbLast : ''}>{c}</span></span>
          ))}
        </nav>
        <div className={s.search}>
          <Input prefix={<Icon name="search" />} suffix={<kbd className={s.kbd}>ctrl+k</kbd>} placeholder="ค้นหาหรือไปที่…" aria-label="ค้นหา" />
        </div>
        <div className={s.topRight}>
          <IconButton name="plus" tooltip="สร้างใหม่" aria-label="สร้างใหม่" />
          <IconButton name="question-circle" tooltip="ช่วยเหลือ" aria-label="ช่วยเหลือ" />
          <IconButton name="bell" tooltip="การแจ้งเตือน" aria-label="การแจ้งเตือน" />
          <IconButton name="adjust-circle" tooltip={mode === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'} onClick={toggle} />
          <span className={s.avatar} aria-label="ผู้ใช้">ส</span>
        </div>
      </header>
      <aside className={s.menu} aria-label="เมนูหลัก">
        {NAV.map((n, i) => (
          <div key={n.href}>
            {n.section && NAV[i - 1]?.section !== n.section && (collapsed ? <div className={s.divider} /> : <div className={s.section}>{n.section}</div>)}
            <Link href={n.href} className={cx(s.item, active(n.href) && s.itemActive, collapsed && s.itemCollapsed)} title={collapsed ? n.label : undefined} aria-label={n.label}>
              <Icon name={n.icon} />
              {!collapsed && <span>{n.label}</span>}
            </Link>
          </div>
        ))}
        <div className={s.spacer} />
        <button className={cx(s.item, s.toggle, collapsed && s.itemCollapsed)} onClick={toggleMenu} aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'} aria-expanded={!collapsed} title={collapsed ? 'ขยายเมนู' : undefined}>
          <Icon name={collapsed ? 'angle-double-right' : 'angle-double-left'} />
          {!collapsed && <span>ย่อเมนู</span>}
        </button>
      </aside>
      <main className={s.main}>{children}</main>
    </div>
  );
}

const styles = (theme: GrafanaTheme2) => ({
  root: css({ display: 'grid', transition: 'grid-template-columns 0.15s ease', gridTemplateRows: '40px 1fr', height: '100vh', background: theme.colors.background.canvas, '@media (max-width: 760px)': { transition: 'none' } }),
  top: css({ gridColumn: '1 / 3', display: 'flex', alignItems: 'center', gap: theme.spacing(2), padding: theme.spacing(0, 2, 0, 0), background: theme.colors.background.primary, borderBottom: `1px solid ${theme.colors.border.weak}`, '@media (max-width: 760px)': { gap: theme.spacing(1), paddingRight: theme.spacing(1) } }),
  logo: css({ transition: 'width 0.15s ease', display: 'flex', alignItems: 'center', gap: theme.spacing(1), padding: theme.spacing(0, 2), color: theme.colors.warning.main, '&:hover': { color: theme.colors.warning.shade } }),
  brand: css({ fontWeight: theme.typography.fontWeightMedium, fontSize: theme.typography.h5.fontSize, color: theme.colors.text.primary }),
  crumbs: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary, flex: 1, minWidth: 0, a: { color: theme.colors.text.secondary, '&:hover': { color: theme.colors.text.primary, textDecoration: 'underline' } }, '@media (max-width: 760px)': { display: 'none' } }),
  crumb: css({ display: 'inline-flex', alignItems: 'center', gap: theme.spacing(0.5) }),
  crumbLast: css({ color: theme.colors.text.primary }),
  search: css({ width: 320, '@media (max-width: 760px)': { display: 'none' } }),
  kbd: css({ fontSize: 10, color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.medium}`, borderRadius: 3, padding: '0 4px' }),
  topRight: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1.5), '@media (max-width: 760px)': { marginLeft: 'auto', gap: theme.spacing(0.5), '& > button:nth-child(-n+3)': { display: 'none' } } }),
  avatar: css({ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, background: theme.colors.primary.main, color: theme.colors.primary.contrastText }),
  menu: css({ display: 'flex', flexDirection: 'column', background: theme.colors.background.primary, borderRight: `1px solid ${theme.colors.border.weak}`, padding: theme.spacing(1, 0), overflow: 'auto' }),
  spacer: css({ flex: 1 }),
  divider: css({ height: 1, margin: theme.spacing(1, 1.5), background: theme.colors.border.weak }),
  itemCollapsed: css({ justifyContent: 'center', padding: 0 }),
  toggle: css({ all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: theme.spacing(1.5), height: 36, width: '100%', padding: theme.spacing(0, 2), color: theme.colors.text.secondary, cursor: 'pointer', '&:hover': { background: theme.colors.action.hover, color: theme.colors.text.primary }, '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: -2 } }),
  section: css({ padding: theme.spacing(2, 2, 0.5), fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.disabled, textTransform: 'uppercase', letterSpacing: 0.4 }),
  item: css({ position: 'relative', display: 'flex', alignItems: 'center', gap: theme.spacing(1.5), height: 36, padding: theme.spacing(0, 2), color: theme.colors.text.secondary, '&:hover': { background: theme.colors.action.hover, color: theme.colors.text.primary } }),
  itemActive: css({
    color: theme.colors.text.primary,
    background: theme.colors.action.hover,
    '&::before': { content: '""', position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, borderRadius: 2, background: theme.colors.gradients.brandVertical },
  }),
  main: css({ overflow: 'auto', minHeight: 0, minWidth: 0 }),
});
