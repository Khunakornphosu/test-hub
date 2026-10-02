'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** โปรเจกต์ที่เลือกอยู่ (จำไว้ในเครื่อง) ถ้าที่จำไว้ถูกลบแล้วใช้โปรเจกต์แรก */
export function useProject() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [savedId, setSavedId] = useState<number | null>(null);
  useEffect(() => {
    try { setSavedId(Number(localStorage.getItem('ts-project')) || null); } catch {}
  }, []);
  const list = projects.data ?? [];
  const current = list.find((p) => p.id === savedId) ?? list[0] ?? null;
  const select = (id: number) => {
    setSavedId(id);
    try { localStorage.setItem('ts-project', String(id)); } catch {}
  };
  return { projects: list, current, select, isLoading: projects.isLoading, error: projects.error as Error | null };
}
