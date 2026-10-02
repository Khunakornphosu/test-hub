'use client';
import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Divider, IconButton, InputBase, MenuItem, Select, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import FiberManualRecord from '@mui/icons-material/FiberManualRecord';
import PlayArrow from '@mui/icons-material/PlayArrow';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import AdsClick from '@mui/icons-material/AdsClick';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import NearMeOutlined from '@mui/icons-material/NearMeOutlined';
import DragIndicator from '@mui/icons-material/DragIndicator';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ArrowDropDownCircleOutlined from '@mui/icons-material/ArrowDropDownCircleOutlined';
import MouseOutlined from '@mui/icons-material/MouseOutlined';
import FormatQuote from '@mui/icons-material/FormatQuote';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ExpandMore from '@mui/icons-material/ExpandMore';
import CheckCircle from '@mui/icons-material/CheckCircle';
import ArrowBack from '@mui/icons-material/ArrowBack';
import ArrowForward from '@mui/icons-material/ArrowForward';
import Refresh from '@mui/icons-material/Refresh';
import Panel from '@/components/Panel';
import MockBrowser from '@/components/MockBrowser';
import { status } from '@/lib/theme';
import { steps } from '@/lib/data';

const ICON: Record<string, React.ReactNode> = {
  open: <PublicOutlined fontSize="small" />,
  type: <EditOutlined fontSize="small" />,
  select: <ArrowDropDownCircleOutlined fontSize="small" />,
  click: <MouseOutlined fontSize="small" />,
  text: <FormatQuote fontSize="small" />,
  url: <LinkOutlined fontSize="small" />,
};

type Mode = 'record' | 'pick' | 'assert' | null;

export default function Workspace() {
  const [mode, setMode] = useState<Mode>(null);
  const [selected, setSelected] = useState(5);
  const sel = steps.find((s) => s.id === selected)!;

  const banner =
    mode === 'record' ? { color: status.fail, text: 'กำลังบันทึก — ทุกการคลิกและพิมพ์ในหน้าเว็บจะกลายเป็น step' }
    : mode === 'pick' ? { color: status.warn, text: 'คลิก element ในหน้าเว็บ เพื่อใช้กับ step ที่กำลังแก้ไข' }
    : mode === 'assert' ? { color: status.pass, text: 'คลิกข้อความหรือ element ที่ต้องการตรวจ' }
    : { color: status.info, text: 'พร้อมใช้งาน — กด "รัน" เพื่อทดสอบ หรือ "บันทึก" เพื่อเพิ่ม step ต่อท้าย' };

  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateRows: '48px 1fr', minHeight: 0 }}>
      {/* แถบเครื่องมือ */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Select size="small" value="shop" variant="outlined" sx={{ minWidth: 110 }}>
          <MenuItem value="shop">Shop</MenuItem>
          <MenuItem value="admin">Admin</MenuItem>
        </Select>
        <Typography color="text.secondary">/</Typography>
        <InputBase defaultValue="Login ด้วยอีเมล" sx={{ fontWeight: 600, fontSize: 14, minWidth: 180 }} inputProps={{ 'aria-label': 'ชื่อเทส' }} />
        <Chip icon={<CheckCircle />} label="รันล่าสุดผ่าน · 5 นาทีที่แล้ว" color="success" variant="outlined" />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => setMode(v)} aria-label="โหมด">
          <ToggleButton value="record" sx={{ gap: 0.75, '&.Mui-selected': { color: status.fail, bgcolor: 'rgba(242,73,92,0.12)' } }}><FiberManualRecord sx={{ fontSize: 14 }} /> บันทึก</ToggleButton>
          <ToggleButton value="pick" sx={{ gap: 0.75, '&.Mui-selected': { color: status.warn, bgcolor: 'rgba(255,152,48,0.12)' } }}><AdsClick sx={{ fontSize: 16 }} /> เลือก element</ToggleButton>
          <ToggleButton value="assert" sx={{ gap: 0.75, '&.Mui-selected': { color: status.pass, bgcolor: 'rgba(115,191,105,0.12)' } }}><FactCheckOutlined sx={{ fontSize: 16 }} /> ตรวจสอบ</ToggleButton>
        </ToggleButtonGroup>
        <Button variant="outlined" color="inherit" startIcon={<AutoAwesome sx={{ color: '#b877d9' }} />} sx={{ borderColor: 'divider' }}>AI</Button>
        <Button variant="contained" color="success" startIcon={<PlayArrow />}>รัน</Button>
      </Box>

      {/* 3 คอลัมน์ */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '300px 1fr 340px' }, gap: 1.5, p: 1.5, minHeight: 0 }}>
        {/* ซ้าย: รายการ step */}
        <Panel title={`Steps (${steps.length})`} actions={<Tooltip title="เพิ่ม step"><IconButton aria-label="เพิ่ม step"><AddOutlined fontSize="small" /></IconButton></Tooltip>} bodySx={{ overflow: 'auto' }}>
          <Box sx={{ p: 0.75, display: 'grid', gap: 0.25 }}>
            {steps.map((s, i) => {
              const on = s.id === selected;
              return (
                <Box key={s.id} onClick={() => setSelected(s.id)} sx={{ display: 'grid', gridTemplateColumns: '14px 18px 26px 1fr', gap: 0.75, alignItems: 'start', p: 0.9, borderRadius: 1, cursor: 'pointer', border: 1, borderColor: on ? 'primary.main' : 'transparent', bgcolor: on ? 'action.selected' : 'transparent', '&:hover': { bgcolor: on ? 'action.selected' : 'action.hover' }, '&:hover .grab': { visibility: 'visible' } }}>
                  <DragIndicator className="grab" sx={{ fontSize: 14, color: 'text.disabled', visibility: 'hidden', mt: 0.4 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.35, textAlign: 'right' }}>{i + 1}</Typography>
                  <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: s.kind === 'assert' ? 'rgba(115,191,105,0.15)' : 'rgba(87,148,242,0.15)', color: s.kind === 'assert' ? status.pass : status.info }}>{ICON[s.icon]}</Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ pt: 0.2 }}>
                      <b>{s.verb}</b>{' '}
                      <Box component="span" sx={{ px: 0.6, borderRadius: 0.75, bgcolor: 'action.hover', border: 1, borderColor: 'divider', fontSize: 12 }}>{s.target}</Box>
                      {s.value && <Box component="span" sx={{ color: 'text.secondary' }}> {s.value}</Box>}
                    </Typography>
                    {s.healed && (
                      <Chip size="small" icon={<BuildOutlined />} label="ซ่อมอัตโนมัติ — รอยืนยัน" sx={{ mt: 0.5, height: 20, fontSize: 11, color: status.warn, borderColor: 'rgba(255,152,48,0.4)' }} variant="outlined" />
                    )}
                  </Box>
                </Box>
              );
            })}
            <Box sx={{ mt: 0.5, p: 1, borderRadius: 1, border: '1px dashed', borderColor: 'divider', textAlign: 'center', color: 'text.secondary', cursor: 'pointer', '&:hover': { borderColor: 'primary.main', color: 'primary.main' } }}>
              <Typography variant="body2">+ ใช้เทสอื่นซ้ำ (block)</Typography>
            </Box>
          </Box>
        </Panel>

        {/* กลาง: หน้าเว็บสด */}
        <Box sx={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', gap: 1, minHeight: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.9, borderRadius: 1, border: 1, borderColor: banner.color, bgcolor: `${banner.color}1a` }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: banner.color, flex: 'none' }} />
            <Typography variant="body2" sx={{ flex: 1 }}>{banner.text}</Typography>
            {mode && <Button size="small" color="inherit" onClick={() => setMode(null)}>ยกเลิก (Esc)</Button>}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton aria-label="ย้อนกลับ"><ArrowBack fontSize="small" /></IconButton>
            <IconButton aria-label="ไปข้างหน้า"><ArrowForward fontSize="small" /></IconButton>
            <IconButton aria-label="โหลดใหม่"><Refresh fontSize="small" /></IconButton>
            <TextField fullWidth defaultValue="https://shop.example.com/login" slotProps={{ htmlInput: { 'aria-label': 'URL', style: { fontSize: 13 } } }} />
            <Button variant="outlined" color="inherit" sx={{ borderColor: 'divider' }}>เปิด</Button>
          </Box>
          <Panel sx={{ outline: mode ? `2px solid ${banner.color}` : 'none', outlineOffset: 1 }}>
            <MockBrowser highlight={mode === 'pick' ? 'button' : null} />
          </Panel>
        </Box>

        {/* ขวา: คุณสมบัติของ step */}
        <Panel title={`แก้ไข step ${steps.findIndex((s) => s.id === selected) + 1}`} bodySx={{ overflow: 'auto' }}>
          <Box sx={{ p: 1.5, display: 'grid', gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">ทำอะไร</Typography>
              <Select fullWidth size="small" value={sel.verb} sx={{ mt: 0.5 }}>
                <MenuItem value={sel.verb}>{sel.verb}</MenuItem>
              </Select>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">กับ element ไหน</Typography>
              <Box sx={{ mt: 0.5, p: 1.25, borderRadius: 1, bgcolor: 'action.hover', display: 'grid', gap: 1 }}>
                <Box><Chip label={sel.target} variant="outlined" /></Box>
                <Typography variant="caption" sx={{ color: status.pass, display: 'flex', alignItems: 'center', gap: 0.5 }}><CheckCircle sx={{ fontSize: 14 }} /> พบ 1 ตัวในหน้านี้ (ไฮไลต์สีเหลือง)</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" variant="outlined" color="inherit" startIcon={<NearMeOutlined />} sx={{ borderColor: 'divider' }} onClick={() => setMode('pick')}>เลือกใหม่จากหน้าเว็บ</Button>
                  <Button size="small" variant="outlined" color="inherit" sx={{ borderColor: 'divider' }}>ทดสอบ</Button>
                </Box>
              </Box>
            </Box>
            {sel.value && (
              <Box>
                <Typography variant="caption" color="text.secondary">ค่า</Typography>
                <TextField fullWidth defaultValue={sel.value.replace(/"/g, '')} sx={{ mt: 0.5 }} />
              </Box>
            )}
            {sel.healed && (
              <Box sx={{ p: 1.25, borderRadius: 1, border: 1, borderColor: 'rgba(255,152,48,0.4)', bgcolor: 'rgba(255,152,48,0.08)', display: 'grid', gap: 1 }}>
                <Typography variant="body2" sx={{ color: status.warn, display: 'flex', gap: 0.5, alignItems: 'center' }}><BuildOutlined sx={{ fontSize: 16 }} /> ซ่อมอัตโนมัติในการรันล่าสุด</Typography>
                <Typography variant="caption" color="text.secondary">locator เดิมหาไม่เจอ ระบบใช้ <b>CSS: #f &gt; button</b> แทน</Typography>
                <Button size="small" variant="outlined" color="warning">ใช้ locator ใหม่</Button>
              </Box>
            )}
            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0, minHeight: 32 }}><Typography variant="caption" sx={{ color: 'primary.main' }}>ขั้นสูง: แก้ locator เอง</Typography></AccordionSummary>
              <AccordionDetails sx={{ px: 0 }}><TextField fullWidth placeholder="role / label / CSS …" /></AccordionDetails>
            </Accordion>
            <Divider />
            <Box>
              <Typography variant="caption" color="text.secondary">ประวัติ step นี้ (20 การรันล่าสุด)</Typography>
              <Box sx={{ display: 'flex', gap: '2px', mt: 0.75, height: 18 }}>
                {'pppppppppppphpppppppp'.slice(0, 20).split('').map((c, i) => <Box key={i} sx={{ flex: 1, borderRadius: '2px', bgcolor: c === 'p' ? status.pass : status.warn, opacity: 0.85 }} />)}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button color="inherit">ยกเลิก</Button>
              <Button variant="contained">บันทึก step</Button>
            </Box>
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}
