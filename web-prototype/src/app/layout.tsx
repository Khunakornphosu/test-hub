import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from '@/lib/theme';
import AppShell from '@/components/AppShell';

const font = IBM_Plex_Sans_Thai({ subsets: ['thai', 'latin'], weight: ['300', '400', '500', '600'], variable: '--font-sans' });

export const metadata: Metadata = { title: 'Test Studio', description: 'เขียนและรันเทสเว็บผ่าน GUI' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning className={font.variable}>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="dark" />
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme} defaultMode="dark">
            <CssBaseline />
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
