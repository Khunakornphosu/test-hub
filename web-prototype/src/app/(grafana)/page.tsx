'use client';
import dynamic from 'next/dynamic';
const Dashboard = dynamic(() => import('@/components/g/Dashboard'), { ssr: false });
export default function Page() { return <Dashboard />; }
