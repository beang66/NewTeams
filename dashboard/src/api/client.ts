import type { RunState } from '@orch/store/state'
import type { Envelope } from '@orch/protocol/messages'
import type { Plan } from '@orch/protocol/plan'

export interface AgentConfig { roles: Record<string, { provider: 'claude' | 'codex'; model: string }> }

export interface TelegramStatus { state: 'off' | 'connecting' | 'connected' | 'error'; botUsername?: string; lastError?: string }

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

async function request(path: string, init?: RequestInit, okStatuses: number[] = []): Promise<Response> {
  const res = await fetch(path, init)
  if (!res.ok && !okStatuses.includes(res.status)) throw await failure(res)
  return res
}

const getJson = async <T>(path: string): Promise<T> => (await request(path)).json() as Promise<T>
const post = (path: string, body?: unknown) =>
  request(path, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

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
  async answer(eventId: string, body: { action: 'guidance' | 'skip'; text: string; restartSession?: boolean }): Promise<void> {
    await post(`/api/human/${encodeURIComponent(eventId)}`, body)
  },
  async resume(): Promise<void> { await post('/api/resume') },
  async ask(question: string): Promise<string> {
    return ((await (await post('/api/ask', { question })).json()) as { answer: string }).answer
  },
}
