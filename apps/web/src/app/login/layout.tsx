'use client';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

// หน้าล็อกอินใช้ธีม Grafana แต่ไม่มีเมนูซ้าย/แถบบน
const Providers = dynamic(() => import('@/components/g/GProviders'), { ssr: false });

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
