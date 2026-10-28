import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { promises as fs } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import type { Workflow } from '../engine/workflow.js'
import type { Envelope } from '../protocol/messages.js'
import { PlanSchema } from '../protocol/plan.js'
import fastifyStatic from '@fastify/static'
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

export interface ServerOptions {
  resume?: boolean
  dashboardDir?: string
  actions?: WorkflowActions
  telegramStatus?: () => TelegramStatus
}

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
  if (options.resume) app.addHook('onListen', async () => { actions.drive() })
  registerReadRoutes(app, wf, streams)
  app.get('/api/telegram', async () => options.telegramStatus?.() ?? { state: 'off' })
  registerActionRoutes(app, actions)
  if (options.dashboardDir) registerDashboard(app, options.dashboardDir)
  return app
}

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
