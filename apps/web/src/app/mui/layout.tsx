import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from '@/lib/theme';
import AppShell from '@/components/AppShell';

// เวอร์ชัน MUI (เก็บไว้เทียบกับเวอร์ชัน Grafana ที่หน้าหลัก)
export default function MuiLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <InitColorSchemeScript attribute="class" defaultMode="dark" />
      <AppRouterCacheProvider>
        <ThemeProvider theme={theme} defaultMode="dark">
          <CssBaseline />
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </AppRouterCacheProvider>
    </>
  );
}
