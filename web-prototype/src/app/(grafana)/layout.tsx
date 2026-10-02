'use client';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import 'react-grid-layout/css/styles.css';

// @grafana/ui ใช้ได้เฉพาะฝั่ง browser จึงโหลดแบบ client-only
const Providers = dynamic(() => import('@/components/g/GProviders'), { ssr: false });
const Shell = dynamic(() => import('@/components/g/GShell'), { ssr: false });

export default function GrafanaLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
