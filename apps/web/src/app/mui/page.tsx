'use client';
import { Box, Chip, Link as MuiLink, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import Panel from '@/components/Panel';
import StatPanel from '@/components/StatPanel';
import StateTimeline from '@/components/StateTimeline';
import BarGauge from '@/components/BarGauge';
import { status } from '@/lib/theme';
import { avgDuration, days, failedPerDay, failures, healedPerDay, passRate, passedPerDay, slowest, sparkDur, sparkHealed, sparkPass, sparkRuns, timeline } from '@/lib/data';

export default function Dashboard() {
  const today = passedPerDay.at(-1)! + failedPerDay.at(-1)!;
  return (
    <Box sx={{ p: 1.5, display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(12, 1fr)', alignContent: 'start' }}>
      <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6', lg: 'span 3' } }}>
        <StatPanel title="อัตราผ่าน" value="94.2" unit="%" delta="▲ 1.3" deltaGood data={sparkPass} color={status.pass} />
      </Box>
      <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6', lg: 'span 3' } }}>
        <StatPanel title="จำนวนการรัน" value={String(today * 3 + 8)} unit="วันนี้" delta="▲ 12" deltaGood data={sparkRuns} color={status.info} />
      </Box>
      <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6', lg: 'span 3' } }}>
        <StatPanel title="เวลาเฉลี่ยต่อการรัน" value="4.8" unit="วินาที" delta="▼ 0.3" deltaGood data={sparkDur} color="#b877d9" />
      </Box>
      <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6', lg: 'span 3' } }}>
        <StatPanel title="locator ที่ซ่อมอัตโนมัติ" value="7" unit="จุด" delta="รอยืนยัน 3" data={sparkHealed} color={status.warn} />
      </Box>

      <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 8' } }}>
        <Panel title="ผ่าน / ไม่ผ่าน รายวัน" actions={<Chip label="14 วัน" variant="outlined" />} bodySx={{ height: 260 }}>
          <BarChart
            height={250}
            xAxis={[{ data: days, scaleType: 'band' }]}
            series={[
              { data: passedPerDay, label: 'ผ่าน', stack: 'a', color: status.pass },
              { data: failedPerDay, label: 'ไม่ผ่าน', stack: 'a', color: status.fail },
            ]}
            margin={{ left: 40, right: 16, top: 24, bottom: 28 }}
            slotProps={{ legend: { direction: 'horizontal', position: { vertical: 'top', horizontal: 'end' } } }}
          />
        </Panel>
      </Box>
      <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 4' } }}>
        <Panel title="อัตราผ่าน (%) และเวลาเฉลี่ย (วินาที)" bodySx={{ height: 260 }}>
          <LineChart
            height={250}
            xAxis={[{ data: days.map((_, i) => i + 1), scaleType: 'point', valueFormatter: (v: number) => `วันที่ ${v}` }]}
            yAxis={[{ id: 'rate', min: 80, max: 100 }, { id: 'sec', min: 0, max: 10 }]}
            series={[
              { data: passRate, label: 'อัตราผ่าน', color: status.pass, curve: 'monotoneX', showMark: false, yAxisId: 'rate' },
              { data: avgDuration, label: 'เวลาเฉลี่ย', color: '#b877d9', curve: 'monotoneX', showMark: false, yAxisId: 'sec' },
            ]}
            margin={{ left: 36, right: 16, top: 24, bottom: 28 }}
            slotProps={{ legend: { direction: 'horizontal', position: { vertical: 'top', horizontal: 'end' } } }}
          />
        </Panel>
      </Box>

      <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 8' } }}>
        <Panel title="สถานะรายเทส · 24 ชั่วโมงล่าสุด">
          <StateTimeline rows={timeline} />
        </Panel>
      </Box>
      <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 4' } }}>
        <Panel title="เทสที่ช้าที่สุด">
          <BarGauge rows={slowest} max={14} unit="วิ" warnAt={10} />
        </Panel>
      </Box>

      <Box sx={{ gridColumn: 'span 12' }}>
        <Panel title="ความล้มเหลวล่าสุด" actions={<MuiLink href="/mui/runs" underline="hover" variant="caption">ดูทั้งหมด</MuiLink>}>
          <Box sx={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12 }}>
            {failures.map((f, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '78px 12px 180px 80px 1fr', gap: 1.5, px: 1.5, py: 0.9, alignItems: 'center', borderBottom: i < failures.length - 1 ? 1 : 0, borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' }, cursor: 'pointer' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'inherit' }}>{f.time}</Typography>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: status.fail }} />
                <Typography variant="body2" noWrap sx={{ fontFamily: 'inherit' }}>{f.test}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'inherit' }}>{f.step}</Typography>
                <Typography variant="body2" noWrap sx={{ fontFamily: 'inherit', color: 'text.secondary' }}>{f.msg}</Typography>
              </Box>
            ))}
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}
