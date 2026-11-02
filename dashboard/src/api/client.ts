import type { RunState } from '@orch/store/state'
import type { Envelope } from '@orch/protocol/messages'
import type { Plan } from '@orch/protocol/plan'
import type { SkillRun } from '@orch/skills/runs'
import type { Routine, RoutineInput } from '@orch/skills/routines'

export type { SkillRun, Routine, RoutineInput }

export interface AgentConfig { roles: Record<string, { provider: 'claude' | 'codex'; model: string }> }

export interface TelegramStatus { state: 'off' | 'connecting' | 'connected' | 'error'; botUsername?: string; lastError?: string }

export type VaultSummary =
  | { state: 'off' }
  | { state: 'error'; error: string }
  | { state: 'connected'; name: string; readFolders: string[]; inbox: string; total: number; groups: { key: string; label: string; count: number }[]; inboxCount: number; scannedAt: string; truncated: boolean }
export interface VaultGraph { nodes: { id: string; title: string; group: string; degree: number }[]; links: { source: string; target: string }[]; truncated: boolean; scannedAt: string }
export interface InstalledSkill { name: string; desc: string; source: 'user' | 'project' | 'plugin' }
export interface VaultHit { path: string; title: string; group: string; snippet: string; mtimeMs: number }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function failure(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`
  try {
    const body = JSON.parse(await res.text()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) message = body.error
  } catch { /* non-JSON body */ }
  return new ApiError(res.status, message)
}

// 프로젝트마다 관제 API가 /p/<이름>/api/... 에 따로 있다. 관제 화면(#/run/<이름>)이 열려 있는 동안만 그 프로젝트를 가리킨다.
let currentProject: string | undefined
export function setProject(name: string | undefined): void { currentProject = name }
const SCOPED = /^\/api\/(state|agents|events|stream|plan|prompts|human|chat|spec|resume|pipeline|ask|project)(\/|\?|$)/
export function scopedPath(path: string): string {
  return currentProject && SCOPED.test(path) ? `/p/${encodeURIComponent(currentProject)}${path}` : path
}

async function request(path: string, init?: RequestInit, okStatuses: number[] = []): Promise<Response> {
  const res = await fetch(scopedPath(path), init)
  if (!res.ok && !okStatuses.includes(res.status)) throw await failure(res)
  return res
}

const getJson = async <T>(path: string): Promise<T> => (await request(path)).json() as Promise<T>
const send = (method: 'POST' | 'PUT', path: string, body: unknown) =>
  request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = (path: string, body?: unknown) =>
  request(path, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

export type LibraryKind = 'brand' | 'content' | 'ideas'
export interface LibraryInput { title: string; status: string; kind: string; tags: string[]; body: string }
export interface LibraryItem extends LibraryInput { file: string; updated: string; mtimeMs: number }

export interface ProjectInfo { name: string; displayName: string }
export interface ProjectSummary extends ProjectInfo { stage: import('@orch/store/state').Stage; pipeline: 'running' | 'stopped' | null }
export interface UsageTotal { tokens: number; costUsd: number; hasCost: boolean }
export interface DashboardUsage { total: UsageTotal; projects: (UsageTotal & { name: string })[]; skills: UsageTotal }

export const api = {
  state: () => getJson<RunState>('/api/state'),
  async plan(): Promise<Plan | null> {
    const res = await request('/api/plan', undefined, [404])
    return res.status === 404 ? null : ((await res.json()) as Plan)
  },
  async telegram(): Promise<TelegramStatus> {
    try { return await getJson<TelegramStatus>('/api/telegram') } catch { return { state: 'off' } }
  },
  agents: () => getJson<AgentConfig>('/api/agents'),
  async vault(): Promise<VaultSummary> {
    try { return await getJson<VaultSummary>('/api/vault') } catch (e) { return { state: 'error', error: e instanceof Error ? e.message : String(e) } }
  },
  vaultGraph: () => getJson<VaultGraph>('/api/vault/graph'),
  skills: () => getJson<InstalledSkill[]>('/api/skills'),
  pinnedSkills: () => getJson<string[]>('/api/skills/pinned'),
  async setPinnedSkills(names: string[]): Promise<void> { await send('PUT', '/api/skills/pinned', names) },
  skillRuns: () => getJson<SkillRun[]>('/api/skills/runs'),
  async runSkill(body: { name: string; input: string; model: string; effort: string }): Promise<SkillRun> {
    return (await post('/api/skills/run', body)).json() as Promise<SkillRun>
  },
  async skillRunAction(id: string, action: 'approve' | 'reject' | 'cancel'): Promise<SkillRun> {
    return (await post(`/api/skills/runs/${encodeURIComponent(id)}/${action}`)).json() as Promise<SkillRun>
  },
  routines: () => getJson<Routine[]>('/api/routines'),
  async saveRoutine(input: RoutineInput, id?: string): Promise<Routine> {
    return (await send(id ? 'PUT' : 'POST', id ? `/api/routines/${encodeURIComponent(id)}` : '/api/routines', input)).json() as Promise<Routine>
  },
  async deleteRoutine(id: string): Promise<void> { await request(`/api/routines/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  library: (kind: LibraryKind) => getJson<LibraryItem[]>(`/api/library/${kind}`),
  libraryItem: (kind: LibraryKind, file: string) => getJson<LibraryItem>(`/api/library/${kind}/${encodeURIComponent(file)}`),
  async createLibraryItem(kind: LibraryKind, input: LibraryInput): Promise<LibraryItem> {
    return (await send('POST', `/api/library/${kind}`, input)).json() as Promise<LibraryItem>
  },
  async updateLibraryItem(kind: LibraryKind, file: string, input: LibraryInput & { mtimeMs: number }): Promise<LibraryItem> {
    return (await send('PUT', `/api/library/${kind}/${encodeURIComponent(file)}`, input)).json() as Promise<LibraryItem>
  },
  async deleteLibraryItem(kind: LibraryKind, file: string): Promise<void> {
    await request(`/api/library/${kind}/${encodeURIComponent(file)}`, { method: 'DELETE' })
  },
  vaultSearch: (q: string, group?: string) =>
    getJson<VaultHit[]>(`/api/vault/search?q=${encodeURIComponent(q)}${group ? `&group=${encodeURIComponent(group)}` : ''}`),
  events: (after?: string) => getJson<Envelope[]>(after ? `/api/events?after=${encodeURIComponent(after)}` : '/api/events'),
  prompt: async (id: string) => (await request(`/api/prompts/${encodeURIComponent(id)}`)).text(),
  async human(path: string): Promise<string | null> {
    const res = await request(`/api/human/${path.split('/').map(encodeURIComponent).join('/')}`, undefined, [404])
    return res.status === 404 ? null : res.text()
  },
  async chat(message: string): Promise<{ reply: string; specDraft?: string }> {
    return (await post('/api/chat', { message })).json() as Promise<{ reply: string; specDraft?: string }>
  },
  async approveSpec(): Promise<void> { await post('/api/spec/approve') },
  project: () => getJson<ProjectInfo>('/api/project'),
  async renameProject(displayName: string): Promise<ProjectInfo> { return (await send('PUT', '/api/project', { displayName })).json() as Promise<ProjectInfo> },
  projects: () => getJson<ProjectSummary[]>('/api/projects'),
  usageAll: () => getJson<DashboardUsage>('/api/usage/all'),
  async startPipeline(): Promise<void> { await post('/api/pipeline/start') },
  async stopPipeline(): Promise<void> { await post('/api/pipeline/stop') },
  async answer(eventId: string, body: { action: 'guidance' | 'skip'; text: string; restartSession?: boolean }): Promise<void> {
    await post(`/api/human/${encodeURIComponent(eventId)}`, body)
  },
  async resume(): Promise<void> { await post('/api/resume') },
  async ask(question: string): Promise<string> {
    return ((await (await post('/api/ask', { question })).json()) as { answer: string }).answer
  },
}
