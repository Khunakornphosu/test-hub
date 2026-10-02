// ตัวเรียก REST API ฝั่งเว็บ (ข้อความ error ภาษาไทยมาจาก server ตรงๆ)
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `เกิดข้อผิดพลาด (${res.status})`, res.status);
  return data as T;
}

export interface Project { id: number; name: string }
export interface TestSummary { id: number; name: string; updatedAt: string; stepCount: number; lastPassed: boolean | null }
export interface TestInfo { id: number; projectId: number; name: string; stepCount: number; updatedAt: string }

export const api = {
  projects: () => call<Project[]>('GET', '/api/projects'),
  createProject: (name: string) => call<{ id: number }>('POST', '/api/projects', { name }),
  deleteProject: (id: number) => call<null>('DELETE', `/api/projects/${id}`),
  tests: (projectId: number) => call<TestSummary[]>('GET', `/api/projects/${projectId}/tests`),
  createTest: (projectId: number, name: string) => call<{ id: number }>('POST', `/api/projects/${projectId}/tests`, { name }),
  test: (id: number) => call<TestInfo>('GET', `/api/tests/${id}`),
  renameTest: (id: number, name: string) => call<null>('PATCH', `/api/tests/${id}`, { name }),
  deleteTest: (id: number) => call<null>('DELETE', `/api/tests/${id}`),
  secrets: (projectId: number) => call<string[]>('GET', `/api/projects/${projectId}/secrets`),
  setSecret: (projectId: number, name: string, value: string) => call<null>('PUT', `/api/projects/${projectId}/secrets/${encodeURIComponent(name)}`, { value }),
  deleteSecret: (projectId: number, name: string) => call<null>('DELETE', `/api/projects/${projectId}/secrets/${encodeURIComponent(name)}`),
  runnerToken: () => call<{ url: string; token: string | null }>('POST', '/api/runner-token'),
};
