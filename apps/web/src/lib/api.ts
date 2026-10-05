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
export interface FlowNode { id: string; type: 'testCase'; testId: number; position: { x: number; y: number } }
export interface FlowEdge { id: string; source: string; target: string; label?: string }
export interface FlowSummary { id: number; projectId: number; name: string; updatedAt: string; nodeCount: number }
export interface FlowInfo extends FlowSummary { nodes: FlowNode[]; edges: FlowEdge[] }

export type RunTarget = { type: 'project' } | { type: 'test'; id: number } | { type: 'flow'; id: number };
export type ScheduleTiming = { kind: 'interval'; minutes: number } | { kind: 'daily'; time: string; days: number[]; timezone?: string };
export type ChannelType = 'slack' | 'discord' | 'webhook' | 'line';
export type ChannelConfig = { type: 'slack' | 'discord' | 'webhook'; url: string } | { type: 'line'; accessToken: string; to: string };
export interface EnvironmentInfo { id: number; projectId: number; name: string; baseUrl: string }
export interface ScheduleInfo { id: number; projectId: number; name: string; target: RunTarget; timing: ScheduleTiming; environmentId: number | null; enabled: boolean; nextRunAt: string; lastRunAt: string | null; timingLabel: string; targetLabel: string }
export interface ScheduleInput { name: string; target: RunTarget; timing: ScheduleTiming; environmentId: number | null; enabled: boolean }
export interface ChannelInfo { id: number; projectId: number; name: string; type: ChannelType; notifyOn: 'problems' | 'always'; enabled: boolean; destination: string }
export interface TokenInfo { id: number; projectId: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }
export interface BatchInfo { id: number; projectId: number; target: RunTarget; trigger: 'schedule' | 'api' | 'manual'; label: string; scheduleId: number | null; environmentName: string | null; status: 'queued' | 'running' | 'done' | 'error'; total: number; failed: number; flaky: number; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; passed: boolean | null }

export const api = {
  projects: () => call<Project[]>('GET', '/api/projects'),
  createProject: (name: string) => call<{ id: number }>('POST', '/api/projects', { name }),
  deleteProject: (id: number) => call<null>('DELETE', `/api/projects/${id}`),
  tests: (projectId: number) => call<TestSummary[]>('GET', `/api/projects/${projectId}/tests`),
  createTest: (projectId: number, name: string) => call<{ id: number }>('POST', `/api/projects/${projectId}/tests`, { name }),
  test: (id: number) => call<TestInfo>('GET', `/api/tests/${id}`),
  flows: (projectId: number) => call<FlowSummary[]>('GET', `/api/projects/${projectId}/flows`),
  createFlow: (projectId: number, name: string) => call<{ id: number }>('POST', `/api/projects/${projectId}/flows`, { name }),
  flow: (id: number) => call<FlowInfo>('GET', `/api/flows/${id}`),
  updateFlow: (id: number, update: Partial<Pick<FlowInfo, 'name' | 'nodes' | 'edges'>>) => call<null>('PATCH', `/api/flows/${id}`, update),
  deleteFlow: (id: number) => call<null>('DELETE', `/api/flows/${id}`),
  renameTest: (id: number, name: string) => call<null>('PATCH', `/api/tests/${id}`, { name }),
  deleteTest: (id: number) => call<null>('DELETE', `/api/tests/${id}`),
  secrets: (projectId: number) => call<string[]>('GET', `/api/projects/${projectId}/secrets`),
  setSecret: (projectId: number, name: string, value: string) => call<null>('PUT', `/api/projects/${projectId}/secrets/${encodeURIComponent(name)}`, { value }),
  deleteSecret: (projectId: number, name: string) => call<null>('DELETE', `/api/projects/${projectId}/secrets/${encodeURIComponent(name)}`),
  environments: (projectId: number) => call<EnvironmentInfo[]>('GET', `/api/projects/${projectId}/environments`),
  createEnvironment: (projectId: number, value: { name: string; baseUrl: string }) => call<{ id: number }>('POST', `/api/projects/${projectId}/environments`, value),
  updateEnvironment: (id: number, value: { name: string; baseUrl: string }) => call<null>('PATCH', `/api/environments/${id}`, value),
  deleteEnvironment: (id: number) => call<null>('DELETE', `/api/environments/${id}`),
  schedules: (projectId: number) => call<ScheduleInfo[]>('GET', `/api/projects/${projectId}/schedules`),
  createSchedule: (projectId: number, value: ScheduleInput) => call<{ id: number }>('POST', `/api/projects/${projectId}/schedules`, value),
  updateSchedule: (id: number, value: ScheduleInput) => call<null>('PATCH', `/api/schedules/${id}`, value),
  deleteSchedule: (id: number) => call<null>('DELETE', `/api/schedules/${id}`),
  runSchedule: (id: number) => call<{ id: number }>('POST', `/api/schedules/${id}/run`),
  channels: (projectId: number) => call<ChannelInfo[]>('GET', `/api/projects/${projectId}/channels`),
  createChannel: (projectId: number, value: { name: string; config: ChannelConfig; notifyOn: 'problems' | 'always' }) => call<{ id: number }>('POST', `/api/projects/${projectId}/channels`, value),
  updateChannel: (id: number, value: { enabled?: boolean; notifyOn?: 'problems' | 'always' }) => call<null>('PATCH', `/api/channels/${id}`, value),
  deleteChannel: (id: number) => call<null>('DELETE', `/api/channels/${id}`),
  testChannel: (id: number) => call<null>('POST', `/api/channels/${id}/test`),
  tokens: (projectId: number) => call<TokenInfo[]>('GET', `/api/projects/${projectId}/tokens`),
  createToken: (projectId: number, name: string) => call<{ id: number; token: string }>('POST', `/api/projects/${projectId}/tokens`, { name }),
  deleteToken: (id: number) => call<null>('DELETE', `/api/tokens/${id}`),
  batches: (projectId: number, page = 1, pageSize = 10) => call<{ items: BatchInfo[]; total: number }>('GET', `/api/projects/${projectId}/batches?page=${page}&pageSize=${pageSize}`),
  batch: (id: number) => call<BatchInfo>('GET', `/api/batches/${id}`),
  runNow: (projectId: number, target: RunTarget, environmentId: number | null) => call<{ id: number }>('POST', `/api/projects/${projectId}/batches`, { target, environmentId }),
  runnerToken: () => call<{ url: string; token: string | null }>('POST', '/api/runner-token'),
};
