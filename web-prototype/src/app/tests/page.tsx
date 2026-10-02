import { Box, Typography } from '@mui/material';
export default function Page() {
  return (
    <Box sx={{ p: 3, color: 'text.secondary' }}>
      <Typography variant="h5" color="text.primary" gutterBottom>เทสเคส</Typography>
      <Typography>หน้านี้ยังไม่ได้ทำใน prototype รอบนี้ (ดู Dashboard และ Workspace)</Typography>
    </Box>
  );
}
