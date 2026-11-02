import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'
import { rebuildState, type RunState } from '@orch/store/state'
import type { Envelope } from '@orch/protocol/messages'
import type { Plan } from '@orch/protocol/plan'

export type FixtureName = 'intake' | 'build' | 'paused' | 'deadlock' | 'done'

/** Every test runs at this instant (13:18 in Asia/Seoul), so "2시간 전부터" and "14:30 재개 · 1시간 12분" are exact. */
export const NOW_ISO = '2026-10-28T04:18:00.000Z'

export interface Fixture {
  plan: Plan | null
  agents: unknown
  telegram: unknown
  events: Envelope[]
  /** Extra state fields merged over the state derived from the events (rarely needed). */
  state?: Partial<RunState>
  /** Served at /api/human/<path>; missing paths answer 404. */
  human: Record<string, string>
  /** Served at /api/prompts/<ref>. */
  prompts: Record<string, string>
  /** Named message ids the tests refer to. */
  ids: Record<string, string>
}

export interface Call { method: string; path: string; body?: unknown }
export interface Reply { status?: number; json?: unknown; text?: string }
export type PostHandler = (body: unknown, mock: Mock) => Reply | void

export interface Mock {
  /** Every POST the page made, in order. */
  calls: Call[]
  fixture: Fixture
  /** Appends an event to the log (id/ts filled in), updates /api/state and streams it to the page. */
  push(event: Partial<Envelope> & Pick<Envelope, 'type' | 'from' | 'to'>): Envelope
  setHuman(path: string, text: string | null): void
  /** Replaces the answer to a POST (exact path, or a prefix ending in "/"). Return nothing for the default 204. */
  onPost(path: string, handler: PostHandler): void
  /** Kills the SSE connection and refuses reconnects (503) until restoreStream(). Pushed events are kept. */
  dropStream(): void
  restoreStream(): void
}

const idNum = (id: string): number => Number(id.slice(4))
const nextId = (events: Envelope[]): string => `msg-${String((events.length ? idNum(events[events.length - 1]!.id) : 0) + 1).padStart(4, '0')}`

export function loadFixture(name: FixtureName): Fixture {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8')) as Fixture
}

/**
 * How the page is fed:
 *  - REST (`/api/state`, `/plan`, `/events`, ...) is answered by `page.route`, from the fixture.
 *  - `/api/stream` is a real held-open text/event-stream served by a tiny local http server (Playwright routes
 *    cannot stream), and an init script points `new EventSource('/api/stream')` at it. That gives true SSE wire
 *    behaviour: `id:`/`event: envelope`/`data:`, replay by `Last-Event-ID`, and reconnects — and `push()`
 *    reaches the open page immediately, with no polling or reconnect trick.
 */
const REAL_PINS = ['content-research-writer', 'doc-coauthoring', 'emil-design-eng', 'graphify', 'ponytail', 'ponytail-review']

export async function mockApi(page: Page, name: FixtureName): Promise<Mock> {
  const fixture = loadFixture(name)
  const events = fixture.events
  const human = new Map(Object.entries(fixture.human))
  const handlers = new Map<string, PostHandler>()
  const calls: Call[] = []
  const clients = new Set<ServerResponse>()
  let streamDown = false

  // 녹화된 픽스처는 사람 시작 기능 이전 것이라, 따로 정하지 않으면 이미 시작된 실행으로 본다.
  const stateNow = (): RunState => ({ pipeline: 'running', ...rebuildState(events), ...fixture.state })
  const frame = (e: Envelope): string => `id: ${e.id}\nevent: envelope\ndata: ${JSON.stringify(e)}\n\n`

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const cors = { 'access-control-allow-origin': '*' }
    if (streamDown) { res.writeHead(503, cors).end(); return }
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write('retry: 500\n\n')
    const last = req.headers['last-event-id']
    const after = typeof last === 'string' && /^msg-\d+$/.test(last) ? idNum(last) : -1
    for (const e of events) if (idNum(e.id) > after) res.write(frame(e))
    clients.add(res)
    res.on('close', () => clients.delete(res))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  page.on('close', () => { for (const c of clients) c.destroy(); server.close() })

  await page.clock.setFixedTime(new Date(NOW_ISO))
  await page.addInitScript((streamPort: number) => {
    const Native = window.EventSource
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        // 프로젝트별 관제(/p/<이름>/api/stream)도 같은 가짜 스트림으로
        super(/^(\/p\/[^/]+)?\/api\/stream$/.test(String(url)) ?`http://127.0.0.1:${streamPort}/api/stream` : url, init)
      }
    }
  }, port)

  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const text = (route: Route, body: string, status = 200) => route.fulfill({ status, contentType: 'text/plain; charset=utf-8', body })

  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.port === String(port)) { await route.continue(); return }
    // 프로젝트별 관제 API(/p/<이름>/api/...)는 같은 픽스처로 응답한다.
    const path = url.pathname.replace(/^\/p\/[^/]+(?=\/api\/)/, '')
    const method = req.method()

    if (method === 'GET') {
      if (path === '/api/state') return json(route, stateNow())
      if (path === '/api/plan') return fixture.plan ? json(route, fixture.plan) : json(route, { error: 'plan 없음' }, 404)
      if (path === '/api/agents') return json(route, fixture.agents)
      if (path === '/api/telegram') return json(route, fixture.telegram)
      // 홈 스킬 카드: 사용자의 실제 고정 스킬 이름(orchestrator DEFAULT_PINNED 앞 6개). 한 쪽 4개라 2쪽까지.
      if (path === '/api/skills') return json(route, REAL_PINS.map((name) => ({ name, desc: `${name} 설명`, source: 'user' })))
      if (path === '/api/skills/pinned') return json(route, REAL_PINS)
      if (path === '/api/project') return json(route, { name: 'todo-app', displayName: 'todo-app' })
      if (path === '/api/projects') { const st = stateNow(); return json(route, [{ name: 'todo-app', displayName: 'todo-app', stage: st.stage, pipeline: st.pipeline ?? null }]) }
      if (path === '/api/usage/all') return json(route, { total: { tokens: 182400, costUsd: 3.42, hasCost: true }, projects: [{ name: 'todo-app', tokens: 45600, costUsd: 0.9, hasCost: true }, { name: 'home', tokens: 136800, costUsd: 2.52, hasCost: true }], skills: { tokens: 12000, costUsd: 0.2, hasCost: true } })
      if (path === '/api/skills/runs' || path === '/api/routines' || path.startsWith('/api/library/')) return json(route, [])
      if (path === '/api/events') {
        const after = url.searchParams.get('after')
        return json(route, after ? events.filter((e) => idNum(e.id) > idNum(after)) : events)
      }
      if (path.startsWith('/api/prompts/')) {
        const p = fixture.prompts[decodeURIComponent(path.slice('/api/prompts/'.length))]
        return p === undefined ? text(route, '', 404) : text(route, p)
      }
      if (path.startsWith('/api/human/')) {
        const doc = human.get(decodeURIComponent(path.slice('/api/human/'.length)))
        return doc === undefined ? text(route, '', 404) : text(route, doc)
      }
      return text(route, '', 404)
    }

    let body: unknown
    const raw = req.postData()
    if (raw) { try { body = JSON.parse(raw) } catch { body = raw } }
    calls.push({ method, path, ...(body === undefined ? {} : { body }) })
    const handler = handlers.get(path) ?? [...handlers].find(([k, h]) => k.endsWith('/') && path.startsWith(k) && h)?.[1]
    const reply = handler?.(body, mock)
    if (reply) {
      if (reply.json !== undefined) return json(route, reply.json, reply.status ?? 200)
      if (reply.text !== undefined) return text(route, reply.text, reply.status ?? 200)
      return route.fulfill({ status: reply.status ?? 204 })
    }
    if (path === '/api/chat') return json(route, { reply: '' })
    if (path === '/api/ask') return json(route, { answer: '' })
    return route.fulfill({ status: 204 })
  })

  const mock: Mock = {
    calls,
    fixture,
    push(partial) {
      const e: Envelope = { id: nextId(events), ts: NOW_ISO, payload: {}, ...partial }
      events.push(e)
      for (const c of clients) c.write(frame(e))
      return e
    },
    setHuman(path, doc) { if (doc === null) human.delete(path); else human.set(path, doc) },
    onPost(path, handler) { handlers.set(path, handler) },
    dropStream() {
      streamDown = true
      for (const c of clients) c.destroy()
      clients.clear()
    },
    restoreStream() { streamDown = false },
  }
  return mock
}
