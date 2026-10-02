'use client';
import { Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';

// panel แบบ Grafana: หัวบาง ชื่ออยู่ซ้าย ปุ่มเสริมอยู่ขวา เนื้อหาเต็มพื้นที่
export default function Panel({ title, actions, children, sx, bodySx }: { title?: string; actions?: ReactNode; children: ReactNode; sx?: object; bodySx?: object }) {
  return (
    <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', ...sx }}>
      {title && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 36, flex: 'none', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>{title}</Typography>
          {actions}
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, ...bodySx }}>{children}</Box>
    </Paper>
  );
}
