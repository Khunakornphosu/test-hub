'use client';
import dynamic from 'next/dynamic';

const AutomationPage = dynamic(() => import('@/components/g/AutomationPage'), { ssr: false });
export default function Page() {
  return <AutomationPage />;
}
