'use client';
import dynamic from 'next/dynamic';
const FlowsPage = dynamic(() => import('@/components/g/FlowsPage'), { ssr: false });
export default function Page() { return <FlowsPage />; }
