'use client';
import { createTheme } from '@mui/material/styles';

// ธีมมืดแบบ Grafana: พื้นเข้ม ขอบบาง ตัวหนังสือเล็ก ข้อมูลแน่น
// สีสถานะใช้ชุดเดียวกันทั้งแอป: เขียว=ผ่าน แดง=พัง เหลือง=ซ่อม/ระวัง น้ำเงิน=ข้อมูล/กำลังทำงาน
export const status = {
  pass: '#73bf69',
  fail: '#f2495c',
  warn: '#ff9830',
  info: '#5794f2',
  idle: '#8e8e9a',
};

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  defaultColorScheme: 'dark',
  colorSchemes: {
    dark: {
      palette: {
        mode: 'dark',
        primary: { main: '#5794f2' },
        success: { main: status.pass },
        error: { main: status.fail },
        warning: { main: status.warn },
        info: { main: status.info },
        background: { default: '#111217', paper: '#181b1f' },
        divider: 'rgba(204,204,220,0.12)',
        text: { primary: '#ccccdc', secondary: 'rgba(204,204,220,0.65)' },
      },
    },
    light: {
      palette: {
        mode: 'light',
        primary: { main: '#3871dc' },
        background: { default: '#f4f5f5', paper: '#ffffff' },
        divider: 'rgba(36,41,46,0.12)',
      },
    },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: 'var(--font-sans), "IBM Plex Sans Thai", system-ui, sans-serif',
    fontSize: 13,
    h5: { fontSize: '1.15rem', fontWeight: 500 },
    h6: { fontSize: '0.95rem', fontWeight: 500 },
    subtitle2: { fontSize: '0.8rem', fontWeight: 500 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiButton: { defaultProps: { size: 'small', disableElevation: true } },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiChip: { defaultProps: { size: 'small' } },
  },
});
