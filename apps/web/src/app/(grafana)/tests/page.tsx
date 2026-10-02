'use client';
import dynamic from 'next/dynamic';

const TestsPage = dynamic(() => import('@/components/g/TestsPage'), { ssr: false });
export default function Page() {
  return <TestsPage />;
}
