'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTheme } from '@grafana/data';
import { GlobalStyles, ThemeContext } from '@grafana/ui';

type Mode = 'dark' | 'light';
const ModeCtx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'dark', toggle: () => {} });
export const useGMode = () => useContext(ModeCtx);

// หน้าตาเหมือน Grafana: ธีมและ component มาจาก @grafana/ui ตรงๆ
export default function GProviders({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('dark');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ts-mode');
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch {}
  }, []);
  const theme = useMemo(
    () => createTheme({ colors: { mode }, typography: { fontFamily: 'var(--font-inter), var(--font-sans), Inter, sans-serif', fontFamilyMonospace: 'var(--font-mono), monospace' } }),
    [mode]
  );
  const toggle = () => setMode((m) => {
    const next = m === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ts-mode', next); } catch {}
    return next;
  });
  return (
    <ModeCtx.Provider value={{ mode, toggle }}>
      <ThemeContext.Provider value={theme}>
        <GlobalStyles />
        {children}
      </ThemeContext.Provider>
    </ModeCtx.Provider>
  );
}
