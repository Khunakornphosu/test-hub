import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const thai = IBM_Plex_Sans_Thai({ subsets: ['thai', 'latin'], weight: ['300', '400', '500', '600'], variable: '--font-sans' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = { title: 'Test Studio', description: 'เขียนและรันเทสเว็บผ่าน GUI' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning className={`${thai.variable} ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
