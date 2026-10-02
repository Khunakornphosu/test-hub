'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Avatar, Box, Button, IconButton, InputBase, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import ListAltOutlined from '@mui/icons-material/ListAltOutlined';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import { useState } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: <DashboardOutlined fontSize="small" /> },
  { href: '/tests', label: 'เทสเคส', icon: <ListAltOutlined fontSize="small" /> },
  { href: '/workspace', label: 'Workspace', icon: <EditNoteOutlined fontSize="small" /> },
  { href: '/runs', label: 'ผลการรัน', icon: <HistoryOutlined fontSize="small" /> },
  { href: '/settings', label: 'ตั้งค่า', icon: <SettingsOutlined fontSize="small" /> },
];

const RAIL = 56;

function RangePicker({ label, onPick, options }: { label: string; onPick: (v: string) => void; options: string[] }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  return (
    <>
      <Button variant="outlined" color="inherit" startIcon={<ScheduleOutlined fontSize="small" />} onClick={(e) => setAnchor(e.currentTarget)} sx={{ borderColor: 'divider', color: 'text.primary' }}>
        {label}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {options.map((o) => (
          <MenuItem key={o} dense onClick={() => { onPick(o); setAnchor(null); }}>{o}</MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { mode, setMode } = useColorScheme();
  const [range, setRange] = useState('7 วันล่าสุด');
  const [refresh, setRefresh] = useState('30 วินาที');
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `${RAIL}px 1fr`, gridTemplateRows: '48px 1fr', height: '100vh' }}>
      {/* แถบซ้าย (rail) */}
      <Box sx={{ gridRow: '1 / 3', borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 0.5 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', mb: 1 }}>
          <ScienceOutlined fontSize="small" />
        </Box>
        {NAV.map((n) => (
          <Tooltip key={n.href} title={n.label} placement="right">
            <IconButton component={Link} href={n.href} sx={{ borderRadius: 1, width: 40, height: 40, color: active(n.href) ? 'primary.main' : 'text.secondary', bgcolor: active(n.href) ? 'action.selected' : 'transparent', position: 'relative', '&::before': active(n.href) ? { content: '""', position: 'absolute', left: -8, top: 8, bottom: 8, width: 3, borderRadius: 2, bgcolor: 'primary.main' } : {} }}>
              {n.icon}
            </IconButton>
          </Tooltip>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={mode === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'} placement="right">
          <IconButton onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} sx={{ color: 'text.secondary' }}>
            {mode === 'dark' ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Avatar sx={{ width: 28, height: 28, fontSize: 13, bgcolor: 'secondary.main', mt: 1 }}>ส</Avatar>
      </Box>

      {/* แถบบน */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Typography variant="subtitle2" color="text.secondary">Test Studio</Typography>
        <Typography variant="subtitle2" color="text.secondary">›</Typography>
        <Typography variant="subtitle2" sx={{ flex: 'none' }}>{NAV.find((n) => active(n.href))?.label ?? ''}</Typography>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, border: 1, borderColor: 'divider', borderRadius: 1, px: 1, height: 30, width: 260 }}>
          <SearchOutlined fontSize="small" sx={{ color: 'text.secondary' }} />
          <InputBase placeholder="ค้นหาเทส…" sx={{ flex: 1, fontSize: 13 }} inputProps={{ 'aria-label': 'ค้นหาเทส' }} />
          <Typography variant="caption" sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.5, color: 'text.secondary' }}>Ctrl K</Typography>
        </Box>
        <RangePicker label={range} onPick={setRange} options={['1 ชั่วโมงล่าสุด', '24 ชั่วโมงล่าสุด', '7 วันล่าสุด', '30 วันล่าสุด']} />
        <RangePicker label={`↻ ${refresh}`} onPick={setRefresh} options={['ปิด', '10 วินาที', '30 วินาที', '1 นาที']} />
        <IconButton aria-label="รีเฟรช"><RefreshOutlined fontSize="small" /></IconButton>
      </Box>

      <Box component="main" sx={{ overflow: 'auto', minHeight: 0 }}>{children}</Box>
    </Box>
  );
}
