'use client';
import { Box, Tooltip, Typography } from '@mui/material';
import { status } from '@/lib/theme';

const COLOR: Record<string, string> = { p: status.pass, f: status.fail, h: status.warn, n: 'rgba(142,142,154,0.25)' };
const LABEL: Record<string, string> = { p: 'ผ่าน', f: 'ไม่ผ่าน', h: 'ผ่านแต่ซ่อม locator', n: 'ไม่ได้รัน' };

// แถบสถานะตามเวลา (state timeline) ของแต่ละเทส ซ้าย=เก่า ขวา=ใหม่
export default function StateTimeline({ rows }: { rows: Record<string, string> }) {
  return (
    <Box sx={{ p: 1.5, display: 'grid', gap: 1 }}>
      {Object.entries(rows).map(([name, states]) => (
        <Box key={name} sx={{ display: 'grid', gridTemplateColumns: '150px 1fr', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="body2" noWrap title={name}>{name}</Typography>
          <Box sx={{ display: 'flex', height: 22, gap: '2px' }}>
            {states.split('').map((s, i) => (
              <Tooltip key={i} title={`${LABEL[s]} · ${24 - i} ชม.ก่อน`}>
                <Box sx={{ flex: 1, bgcolor: COLOR[s], borderRadius: '2px', opacity: s === 'n' ? 1 : 0.85, '&:hover': { opacity: 1 } }} />
              </Tooltip>
            ))}
          </Box>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 0.5 }}>
        {(['p', 'h', 'f'] as const).map((k) => (
          <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: COLOR[k] }} />
            <Typography variant="caption" color="text.secondary">{LABEL[k]}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
