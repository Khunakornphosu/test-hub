'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Project } from './api';

const STORAGE_KEY = 'ts-project';

interface ProjectState {
  projects: Project[];
  current: Project | null;
  select: (id: number) => void;
  isLoading: boolean;
  error: Error | null;
}

const ProjectContext = createContext<ProjectState | null>(null);

/** โปรเจกต์ที่เลือกอยู่ใช้ร่วมกันทั้งแอป (ตัวสลับใน sidebar และทุกหน้า) จำไว้ในเครื่อง ถ้าที่จำไว้ถูกลบแล้วใช้โปรเจกต์แรก */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [savedId, setSavedId] = useState<number | null>(null);
  useEffect(() => {
    try { setSavedId(Number(localStorage.getItem(STORAGE_KEY)) || null); } catch {}
  }, []);
  const select = useCallback((id: number) => {
    setSavedId(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch {}
  }, []);
  const value = useMemo<ProjectState>(() => {
    const list = projects.data ?? [];
    return {
      projects: list,
      current: list.find((p) => p.id === savedId) ?? list[0] ?? null,
      select,
      isLoading: projects.isLoading,
      error: projects.error as Error | null,
    };
  }, [projects.data, projects.isLoading, projects.error, savedId, select]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const state = useContext(ProjectContext);
  if (!state) throw new Error('useProject ต้องอยู่ภายใน ProjectProvider');
  return state;
}
