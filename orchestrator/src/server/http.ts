import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import type { Workflow } from '../engine/workflow.js'
import type { Envelope } from '../protocol/messages.js'
import { PlanSchema } from '../protocol/plan.js'
import fastifyStatic from '@fastify/static'
import { Vault, VaultError } from '../vault/vault.js'
import { dashboardUsage } from '../usage/dashboardUsage.js'
import { LIBRARY_KINDS, Library, type LibraryInput, type LibraryKind } from '../vault/library.js'
import { SKILL_EFFORTS, SKILL_MODELS, SkillNotFound, type SkillInfo } from '../skills/skills.js'
import { RunConflict, RunNotFound, SkillBusy, type SkillRuns } from '../skills/runs.js'
import { RoutineNotFound, type RoutineInput, type Routines } from '../skills/routines.js'

import { ActionConflict, createWorkflowActions, createWorkflowDriver, type TelegramStatus, type WorkflowActions } from './actions.js'

const ID_PATTERN = '^msg-[0-9]+$'
const textBody = (key: string) => ({
  type: 'object', required: [key], additionalProperties: false,
  properties: { [key]: { type: 'string', minLength: 1 } },
})
const idParams = (key: string) => ({
  type: 'object', required: [key], properties: { [key]: { type: 'string', pattern: ID_PATTERN } },
})
const mime: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.zip': 'application/zip',
}

export { createWorkflowDriver }

export interface SkillServices { list(): Promise<SkillInfo[]>; runs: SkillRuns; routines: Routines }

export interface ServerOptions {
  resume?: boolean
  dashboardDir?: string
  actions?: WorkflowActions
  telegramStatus?: () => TelegramStatus
  vault?: Vault
  skills?: SkillServices
  /** 같은 서버에서 함께 여는 다른 프로젝트. 각자 `/p/<이름>/api/...`에 자기 관제 API를 갖는다. */
  projects?: ProjectHandle[]
}

export interface ProjectHandle { name: string; wf: Workflow; actions: WorkflowActions }

export function buildServer(wf: Workflow, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify()
  const actions = options.actions ?? createWorkflowActions(wf, async (error) => {
    console.error('Workflow failed; answer the human request to retry', error)
    await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', payload: {
      reason: 'workflow_error', detail: error instanceof Error ? error.message : String(error),
    } })
  })
  const streams = new Set<ServerResponse>()
  // preClose runs before waiting for active HTTP connections (including SSE).
  app.addHook('preClose', async () => { for (const stream of streams) stream.destroy() })
  // 127.0.0.1에만 열어도 브라우저의 다른 사이트가 요청을 보낼 수 있다(본문 없는 POST는 CORS 사전 확인도 없음, DNS 리바인딩).
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (!isLocalHost(request.headers.host) || (origin !== undefined && !isLocalHost(hostOf(origin)))) {
      return reply.code(403).send({ error: '로컬 요청만 허용' })
    }
  })
  if (options.resume) app.addHook('onListen', async () => { actions.drive() })
  registerReadRoutes(app, wf, streams)
  app.get('/api/telegram', async () => options.telegramStatus?.() ?? { state: 'off' })
  registerActionRoutes(app, actions)
  registerProjectMeta(app, wf)
  // 프로젝트마다 자기 관제 API: /p/<이름>/api/... (주 프로젝트는 위의 /api/...로도 열린다)
  const primaryDir = resolve(wf.store.paths.raw, '..')
  const all: ProjectHandle[] = [{ name: basename(primaryDir), wf, actions }, ...(options.projects ?? [])]
  for (const p of all) {
    void app.register(async (sub) => {
      registerReadRoutes(sub, p.wf, streams)
      registerActionRoutes(sub, p.actions)
      registerProjectMeta(sub, p.wf)
    }, { prefix: `/p/${p.name}` })
  }
  // 다른 프로젝트도 사람이 시작해 둔(running) 실행이면 서버를 켤 때 이어서 돈다.
  if (options.resume) for (const p of options.projects ?? []) app.addHook('onListen', async () => { p.actions.drive() })
  app.get('/api/projects', async () => Promise.all(all.map(async (p) => ({
    name: p.name, displayName: await displayNameOf(p.wf), stage: p.wf.state().stage, pipeline: p.wf.state().pipeline ?? null,
  }))))
  // 대시보드 전체(모든 프로젝트 + 스킬 실행) 사용량
  app.get('/api/usage/all', async () => dashboardUsage(dirname(primaryDir)))
  registerVaultRoutes(app, options.vault)
  registerSkillRoutes(app, options.skills)
  if (options.dashboardDir) registerDashboard(app, options.dashboardDir)
  return app
}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const isLocalHost = (host: string | undefined): boolean => host !== undefined && LOCAL_HOST.test(host)
const hostOf = (url: string): string | undefined => { try { return new URL(url).host } catch { return undefined } }

export function listenLocal(app: FastifyInstance, port: number): Promise<string> {
  return app.listen({ host: '127.0.0.1', port })
}

function registerReadRoutes(app: FastifyInstance, wf: Workflow, streams: Set<ServerResponse>): void {
  app.get('/api/state', async () => wf.state())
  app.get('/api/agents', async () => wf.agentConfiguration())
  app.get<{ Querystring: { after?: string } }>('/api/events', {
    schema: { querystring: { type: 'object', properties: { after: { type: 'string', pattern: ID_PATTERN } } } },
  }, async (request) => eventsAfter(await wf.store.readEvents(), request.query.after))
  app.get<{ Headers: { 'last-event-id'?: string } }>('/api/stream', {
    schema: { headers: { type: 'object', properties: { 'last-event-id': { type: 'string', pattern: ID_PATTERN } } } },
  }, async (request, reply) => {
    await streamEvents(wf, reply, streams, request.headers['last-event-id'])
  })
  app.get('/api/plan', async (_request, reply) => {
    let text: string
    try { text = await fs.readFile(wf.store.paths.plan, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ error: 'plan 없음' })
      throw error
    }
    try { return PlanSchema.parse(JSON.parse(text)) } catch (error) {
      return reply.code(500).send({ error: `plan.json 읽기 실패: ${error instanceof Error ? error.message : String(error)}` })
    }
  })
  app.get<{ Params: { id: string } }>('/api/prompts/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' } } } },
  }, async (request, reply) => {
    const event = (await wf.store.readEvents()).find((event) => event.id === request.params.id)
    const prefix = 'raw/prompts/'
    const ref = event?.promptRef
    const path = ref?.startsWith(prefix) ? ref.slice(prefix.length) : `${request.params.id}.txt`
    return sendFile(reply, wf.store.paths.prompts, path, 'text/plain; charset=utf-8')
  })
  app.get<{ Params: { '*': string } }>('/api/human/*', async (request, reply) => {
    const path = request.params['*']
    return sendFile(reply, wf.store.paths.human, path, mime[extname(path).toLowerCase()] ?? 'application/octet-stream')
  })
}

const projectFile = (wf: Workflow) => join(resolve(wf.store.paths.raw, '..'), 'project.json')
/** 화면에 보이는 프로젝트 이름. 폴더 이름(주소에 쓰임)은 그대로 두고 project.json에만 저장한다. */
async function displayNameOf(wf: Workflow): Promise<string> {
  try {
    const v = (JSON.parse(await fs.readFile(projectFile(wf), 'utf8')) as { displayName?: unknown }).displayName
    if (typeof v === 'string' && v.trim()) return v
  } catch { /* 없음 */ }
  return basename(resolve(wf.store.paths.raw, '..'))
}

function registerProjectMeta(app: FastifyInstance, wf: Workflow): void {
  const name = basename(resolve(wf.store.paths.raw, '..'))
  app.get('/api/project', async () => ({ name, displayName: await displayNameOf(wf) }))
  app.put<{ Body: { displayName: string } }>('/api/project', {
    schema: { body: { type: 'object', required: ['displayName'], additionalProperties: false, properties: { displayName: { type: 'string', minLength: 1, maxLength: 80 } } } },
  }, async (request) => {
    const displayName = request.body.displayName.trim()
    if (!displayName) return { name, displayName: await displayNameOf(wf) }
    await fs.writeFile(projectFile(wf), JSON.stringify({ displayName }, null, 2))
    return { name, displayName }
  })
}

function registerDashboard(app: FastifyInstance, dashboardDir: string): void {
  void app.register(fastifyStatic, { root: resolve(dashboardDir), prefix: '/', wildcard: false, index: ['index.html'] })
  // SPA fallback: client-side routes get index.html; API misses keep the JSON 404.
  app.setNotFoundHandler((request, reply) => {
    if ((request.method === 'GET' || request.method === 'HEAD') && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 })
  })
}

function registerActionRoutes(app: FastifyInstance, actions: WorkflowActions): void {
  const run = async (reply: FastifyReply, action: () => Promise<unknown>): Promise<unknown> => {
    try { return await action() } catch (error) {
      if (error instanceof ActionConflict) return reply.code(409).send({ error: error.message })
      throw error
    }
  }
  const noContent = (reply: FastifyReply, action: () => Promise<unknown>) =>
    run(reply, async () => { await action(); return reply.code(204).send() })
  app.post<{ Body: { message: string } }>('/api/chat', { schema: { body: textBody('message') } },
    async (request, reply) => run(reply, () => actions.chat(request.body.message)))
  app.post('/api/spec/approve', async (_request, reply) => noContent(reply, () => actions.approveSpec()))
  app.post<{ Params: { eventId: string }; Body: { action: 'guidance' | 'skip'; text: string; restartSession?: boolean } }>('/api/human/:eventId', {
    schema: {
      params: idParams('eventId'),
      body: {
        type: 'object', required: ['action', 'text'], additionalProperties: false,
        properties: { action: { type: 'string', enum: ['guidance', 'skip'] }, text: { type: 'string' }, restartSession: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => noContent(reply, () => actions.answer(request.params.eventId, request.body)))
  app.post('/api/resume', async (_request, reply) => noContent(reply, () => actions.resume()))
  app.post('/api/pipeline/start', async (_request, reply) => noContent(reply, () => actions.startPipeline()))
  app.post('/api/pipeline/stop', async (_request, reply) => noContent(reply, () => actions.stopPipeline()))
  app.post<{ Body: { question: string } }>('/api/ask', { schema: { body: textBody('question') } },
    async (request) => ({ answer: await actions.ask(request.body.question) }))
}

function eventsAfter(events: Envelope[], after?: string): Envelope[] {
  const cursor = after ? BigInt(after.slice(4)) : 0n
  return events.filter((event) => BigInt(event.id.slice(4)) > cursor)
}

async function streamEvents(wf: Workflow, reply: FastifyReply, streams: Set<ServerResponse>, after?: string): Promise<void> {
  const raw = reply.raw
  const buffered: Envelope[] = []
  let replaying = true
  let flushing = false
  let cursor = after ? BigInt(after.slice(4)) : 0n
  const send = async (event: Envelope) => {
    const seq = BigInt(event.id.slice(4))
    if (raw.destroyed || seq <= cursor) return
    cursor = seq
    if (!raw.write(`id: ${event.id}\nevent: envelope\ndata: ${JSON.stringify(event)}\n\n`)) await waitForDrain(raw)
  }
  const flush = async () => {
    if (flushing) return
    flushing = true
    try {
      while (buffered.length && !raw.destroyed) await send(buffered.shift()!)
    } catch { raw.destroy() } finally { flushing = false }
  }
  const detach = wf.bus.subscribe((event) => {
    // Bound queued live traffic for stalled consumers; durable history supports reconnect.
    if (buffered.length >= 1000) { raw.destroy(); return }
    buffered.push(event)
    if (!replaying) void flush()
  })
  const cleanup = () => { detach(); streams.delete(raw); buffered.length = 0 }
  raw.once('close', cleanup)
  streams.add(raw)
  try {
    // Subscribe before reading disk so events published during replay cannot be lost.
    const history = await wf.store.readEvents()
    if (raw.destroyed) return
    reply.hijack()
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    })
    raw.flushHeaders()
    for (const event of history) await send(event)
    replaying = false
    await flush()
  } catch (error) { cleanup(); if (reply.sent) raw.destroy(); else throw error }
}

function waitForDrain(raw: ServerResponse): Promise<void> {
  if (raw.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { raw.off('drain', done); raw.off('close', done); resolve() }
    raw.once('drain', done)
    raw.once('close', done)
  })
}

async function sendFile(reply: FastifyReply, root: string, path: string, contentType: string): Promise<unknown> {
  if (!path || path.includes('\0') || path.includes('\\') || path.includes(':') || isAbsolute(path) || path.split('/').includes('..')) {
    return reply.code(400).send({ error: '잘못된 파일 경로' })
  }
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(resolve(root, path))])
    const rel = relative(realRoot, realFile)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return reply.code(400).send({ error: '경로가 허용 범위를 벗어남' })
    if (!(await fs.stat(realFile)).isFile()) return reply.code(404).send({ error: '파일 없음' })
    return reply.type(contentType).send(await fs.readFile(realFile))
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return reply.code(404).send({ error: '파일 없음' })
    throw error
  }
}

const RUN_FIELDS = {
  input: { type: 'string', maxLength: 10_000 },
  model: { type: 'string', enum: Object.keys(SKILL_MODELS) }, effort: { type: 'string', enum: [...SKILL_EFFORTS] },
}
const ROUTINE_BODY = { type: 'object', additionalProperties: false, required: ['name', 'skill', 'input', 'model', 'effort', 'schedule', 'enabled'], properties: {
  name: { type: 'string', minLength: 1, maxLength: 100 }, skill: { type: 'string', minLength: 1, maxLength: 200 }, ...RUN_FIELDS, enabled: { type: 'boolean' },
  schedule: { type: 'object', additionalProperties: false, required: ['kind', 'time'], properties: {
    kind: { type: 'string', enum: ['daily', 'weekly'] }, time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    days: { type: 'array', maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 6 } },
  } },
} }

/** 설치된 스킬·고정 목록·실행(시작은 바로 응답, 상태는 조회)·승인·중단·기록과 루틴 CRUD. */
function registerSkillRoutes(app: FastifyInstance, skills: SkillServices | undefined): void {
  const off = (reply: FastifyReply) => reply.code(404).send({ error: '스킬 실행이 연결되지 않음' })
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof SkillNotFound || error instanceof RunNotFound || error instanceof RoutineNotFound) return reply.code(404).send({ error: error.message })
    if (error instanceof SkillBusy || error instanceof RunConflict) return reply.code(409).send({ error: error.message })
    throw error
  }
  const idParams = { type: 'object', properties: { id: { type: 'string', pattern: '^[\\w-]{1,64}$' } } }
  app.get('/api/skills', async () => (skills ? skills.list() : []))
  app.get('/api/skills/pinned', async () => (skills ? skills.runs.pinned() : []))
  app.put<{ Body: string[] }>('/api/skills/pinned', { schema: { body: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 200 } } } },
    async (request, reply) => { if (!skills) return off(reply); await skills.runs.setPinned(request.body); return reply.code(204).send() })
  app.get('/api/skills/runs', async () => (skills ? skills.runs.recent() : []))
  app.post<{ Body: { name: string; input?: string; model?: string; effort?: string } }>('/api/skills/run', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, ...RUN_FIELDS } } },
  }, async (request, reply) => {
    if (!skills) return off(reply)
    const { name, input = '', model = '기본 모델', effort = '기본' } = request.body
    try { return reply.code(202).send(await skills.runs.start({ skill: name, input, model, effort })) } catch (error) { return fail(reply, error) }
  })
  for (const action of ['approve', 'reject', 'cancel'] as const) {
    app.post<{ Params: { id: string } }>(`/api/skills/runs/:id/${action}`, { schema: { params: idParams } }, async (request, reply) => {
      if (!skills) return off(reply)
      try {
        if (action === 'cancel') { skills.runs.cancel(request.params.id); return skills.runs.get(request.params.id) }
        return await skills.runs[action](request.params.id)
      } catch (error) { return fail(reply, error) }
    })
  }
  app.get('/api/routines', async () => (skills ? skills.routines.list() : []))
  app.post<{ Body: RoutineInput }>('/api/routines', { schema: { body: ROUTINE_BODY } }, async (request, reply) => {
    if (!skills) return off(reply)
    return reply.code(201).send(await skills.routines.create(request.body))
  })
  app.put<{ Params: { id: string }; Body: RoutineInput }>('/api/routines/:id', { schema: { params: idParams, body: ROUTINE_BODY } }, async (request, reply) => {
    if (!skills) return off(reply)
    try { return await skills.routines.update(request.params.id, request.body) } catch (error) { return fail(reply, error) }
  })
  app.delete<{ Params: { id: string } }>('/api/routines/:id', { schema: { params: idParams } }, async (request, reply) => {
    if (!skills) return off(reply)
    try { await skills.routines.remove(request.params.id); return reply.code(204).send() } catch (error) { return fail(reply, error) }
  })
}

/** Obsidian Vault: 허용 폴더 읽기·검색과 AI Inbox 쓰기. 연결하지 않았으면 state: off. */
function registerVaultRoutes(app: FastifyInstance, vault: Vault | undefined): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof VaultError) return reply.code(error.status).send({ error: error.message })
    throw error
  }
  app.get('/api/vault', async (_request, reply) => {
    if (!vault) return { state: 'off' }
    try { return await vault.summary() } catch (error) {
      return reply.code(503).send({ state: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.get('/api/vault/graph', async (_request, reply) => {
    if (!vault) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return await vault.graph() } catch (error) { return fail(reply, error) }
  })
  app.get<{ Querystring: { q: string; group?: string; limit?: number } }>('/api/vault/search', {
    schema: { querystring: { type: 'object', required: ['q'], properties: {
      q: { type: 'string', minLength: 1, maxLength: 200 }, group: { type: 'string', pattern: '^[a-z]+$' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    } } },
  }, async (request, reply) => {
    if (!vault) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return await vault.search(request.query.q, request.query.limit ?? 20, request.query.group) } catch (error) { return fail(reply, error) }
  })
  app.get<{ Querystring: { path: string } }>('/api/vault/note', {
    schema: { querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 500 } } } },
  }, async (request, reply) => {
    if (!vault) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return await vault.note(request.query.path) } catch (error) { return fail(reply, error) }
  })
  app.post<{ Body: { title: string; body: string; project?: string; runId?: string; sources?: string[] } }>('/api/vault/inbox', {
    schema: { body: { type: 'object', required: ['title', 'body'], additionalProperties: false, properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 200_000 },
      project: { type: 'string', maxLength: 200 }, runId: { type: 'string', maxLength: 100 },
      sources: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 500 } },
    } } },
  }, async (request, reply) => {
    if (!vault) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return reply.code(201).send(await vault.writeInbox(request.body)) } catch (error) { return fail(reply, error) }
  })

  // 라이브러리: Vault의 Libraries/brand|content|ideas 안에서만 읽기·쓰기(library.ts).
  const library = vault && new Library(vault.root)
  const kindParams = { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: [...LIBRARY_KINDS] } } }
  const fileParams = { type: 'object', required: ['kind', 'file'], properties: { ...kindParams.properties, file: { type: 'string', minLength: 4, maxLength: 200 } } }
  const itemProps = {
    title: { type: 'string', minLength: 1, maxLength: 200 }, status: { type: 'string', maxLength: 50 }, kind: { type: 'string', maxLength: 50 },
    tags: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 50 } }, body: { type: 'string', maxLength: 200_000 },
  }
  const itemBody = { type: 'object', required: ['title', 'status', 'kind', 'tags', 'body'], additionalProperties: false, properties: itemProps }
  const updateBody = { ...itemBody, required: [...itemBody.required, 'mtimeMs'], properties: { ...itemProps, mtimeMs: { type: 'number' } } }
  type K = { kind: LibraryKind }
  type KF = K & { file: string }
  app.get<{ Params: K }>('/api/library/:kind', { schema: { params: kindParams } }, async (request, reply) => {
    if (!library) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return await library.list(request.params.kind) } catch (error) { return fail(reply, error) }
  })
  app.get<{ Params: KF }>('/api/library/:kind/:file', { schema: { params: fileParams } }, async (request, reply) => {
    if (!library) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return await library.get(request.params.kind, request.params.file) } catch (error) { return fail(reply, error) }
  })
  app.post<{ Params: K; Body: LibraryInput }>('/api/library/:kind', { schema: { params: kindParams, body: itemBody } }, async (request, reply) => {
    if (!library) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return reply.code(201).send(await library.create(request.params.kind, request.body)) } catch (error) { return fail(reply, error) }
  })
  app.put<{ Params: KF; Body: LibraryInput & { mtimeMs: number } }>('/api/library/:kind/:file', { schema: { params: fileParams, body: updateBody } }, async (request, reply) => {
    if (!library) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { return await library.update(request.params.kind, request.params.file, request.body) } catch (error) { return fail(reply, error) }
  })
  app.delete<{ Params: KF }>('/api/library/:kind/:file', { schema: { params: fileParams } }, async (request, reply) => {
    if (!library) return reply.code(404).send({ error: 'Vault 연결 안 됨' })
    try { await library.remove(request.params.kind, request.params.file); return reply.code(204).send() } catch (error) { return fail(reply, error) }
  })
}
