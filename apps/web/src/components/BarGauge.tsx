'use client';
import { Box, Typography } from '@mui/material';
import { status } from '@/lib/theme';

// แท่งแนวนอนไล่สีตามค่า แบบ Grafana "Bar gauge"
export default function BarGauge({ rows, max, unit, warnAt }: { rows: { name: string; sec: number }[]; max: number; unit: string; warnAt: number }) {
  return (
    <Box sx={{ p: 1.5, display: 'grid', gap: 1.25 }}>
      {rows.map((r) => {
        const color = r.sec >= warnAt ? status.fail : r.sec >= warnAt * 0.6 ? status.warn : status.pass;
        return (
          <Box key={r.name}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2" noWrap>{r.name}</Typography>
              <Typography variant="body2" sx={{ color }}>{r.sec.toFixed(1)} {unit}</Typography>
            </Box>
            <Box sx={{ height: 8, mt: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Box sx={{ width: `${(r.sec / max) * 100}%`, height: '100%', borderRadius: 1, bgcolor: color }} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
