'use client';
import { Box, Typography } from '@mui/material';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import Panel from './Panel';

// panel ตัวเลขใหญ่ + กราฟเส้นเล็กด้านหลัง แบบ Grafana "Stat"
export default function StatPanel({ title, value, unit, delta, deltaGood, data, color }: { title: string; value: string; unit?: string; delta?: string; deltaGood?: boolean; data: number[]; color: string }) {
  return (
    <Panel title={title} bodySx={{ position: 'relative', minHeight: 110 }}>
      <Box sx={{ position: 'absolute', inset: 0, top: 'auto', height: 64, opacity: 0.4 }}>
        <SparkLineChart data={data} height={64} area curve="monotoneX" color={color} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} />
      </Box>
      <Box sx={{ position: 'relative', p: 1.5, display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: 34, fontWeight: 500, lineHeight: 1.1, color }}>{value}</Typography>
        {unit && <Typography color="text.secondary">{unit}</Typography>}
        {delta && (
          <Typography variant="caption" sx={{ ml: 'auto', color: deltaGood ? 'success.main' : 'error.main' }}>{delta}</Typography>
        )}
      </Box>
    </Panel>
  );
}
