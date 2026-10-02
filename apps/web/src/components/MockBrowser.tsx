'use client';
import { Box, Typography } from '@mui/material';

// หน้าเว็บจำลองแทน screencast จริง (ในระบบจริงเป็น canvas ที่รับภาพจาก runner)
// แยกสีเป็นของตัวเอง ไม่ใช้ theme เพราะเป็นเว็บของคนอื่นที่กำลังทดสอบ
export default function MockBrowser({ highlight }: { highlight?: 'email' | 'button' | null }) {
  // ไฮไลต์ตอนเลือก element: วางกรอบสีส้มทับ ไม่เปลี่ยนสีพื้นเดิม ข้อความจะได้ยังอ่านได้
  const ring = (on: boolean) => (on ? { outline: '2px solid #ff9830', outlineOffset: 2, boxShadow: '0 0 0 6px rgba(255,152,48,0.2)' } : {});
  return (
    <Box sx={{ bgcolor: '#f3f4f8', color: '#1f2328', height: '100%', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <Box sx={{ bgcolor: '#fff', borderRadius: 2, p: 4, width: 340, boxShadow: '0 4px 16px rgba(0,0,0,.1)', display: 'grid', gap: 1.5 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 600, color: '#1f2328' }}>เข้าสู่ระบบ</Typography>
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontSize: 13, color: '#1f2328' }}>อีเมล</Typography>
          <Box sx={{ border: '1px solid #ccc', borderRadius: 1, px: 1.25, py: 1, fontSize: 14, color: '#1f2328', ...ring(highlight === 'email') }}>somchai@test.com</Box>
        </Box>
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontSize: 13, color: '#1f2328' }}>รหัสผ่าน</Typography>
          <Box sx={{ border: '1px solid #ccc', borderRadius: 1, px: 1.25, py: 1, fontSize: 14, color: '#1f2328' }}>••••••••</Box>
        </Box>
        <Box sx={{ bgcolor: '#3557e0', color: '#fff', textAlign: 'center', py: 1.1, borderRadius: 1, fontSize: 14, fontWeight: 500, ...ring(highlight === 'button') }}>เข้าสู่ระบบ</Box>
      </Box>
    </Box>
  );
}
