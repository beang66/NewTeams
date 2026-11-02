import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Workflow } from '../../src/engine/workflow.js'
import { buildServer, createWorkflowDriver, listenLocal } from '../../src/server/http.js'
import { createWorkflowActions } from '../../src/server/actions.js'
import { attachNotifier } from '../../src/server/notifier.js'
import { SkillRuns } from '../../src/skills/runs.js'
import { Routines } from '../../src/skills/routines.js'
import type { RunRequest, RunResult } from '../../src/runners/types.js'
import { fakeDeps, makeScript } from '../fixtures/scripts/common.js'

let dir: string
let wf: Workflow
let app: FastifyInstance
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orch-http-'))
  wf = await Workflow.open(dir, fakeDeps(makeScript()))
  app = buildServer(wf)
})
afterEach(async () => {
  await app?.close()
  await fs.rm(dir, { recursive: true, force: true })
})
const publish = () => wf.bus.publish({ type: 'REPORT', from: 'test', to: 'all', payload: {} })

describe('HTTP API', { timeout: 30_000 }, () => {
  it('스킬: 실행은 바로 202, 기록·중단·고정·루틴 CRUD, 잘못된 입력은 거부', async () => {
    const list = async () => [{ name: 'ponytail', desc: 'lazy', source: 'user' as const }]
    const claude = { run: (req: RunRequest) => new Promise<RunResult>((_ok, fail) => req.signal!.addEventListener('abort', () => fail(new Error('killed')))) }
    const runs = new SkillRuns(join(dir, 'skill-runs'), claude, list, 10_000)
    await app.close()
    app = buildServer(wf, { skills: { list, runs, routines: new Routines(join(dir, 'skill-runs', 'routines.json'), runs) } })
    expect((await app.inject('/api/skills')).json()).toEqual([{ name: 'ponytail', desc: 'lazy', source: 'user' }])
    const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, ...(payload ? { payload } : {}) })
    const started = await post('/api/skills/run', { name: 'ponytail', input: '리뷰해줘', model: 'Sonnet', effort: 'high' })
    expect(started.statusCode).toBe(202)
    const id = started.json().id as string
    expect((await post('/api/skills/run', { name: 'ponytail' })).statusCode).toBe(409) // 한 번에 하나
    expect((await post(`/api/skills/runs/${id}/cancel`)).statusCode).toBe(200)
    for (let i = 0; i < 100 && runs.busy(); i++) await new Promise((ok) => setTimeout(ok, 5))
    expect((await app.inject('/api/skills/runs')).json()[0]).toMatchObject({ id, status: 'cancelled' })
    expect((await post('/api/skills/run', { name: 'nope' })).statusCode).toBe(404)
    expect((await post('/api/skills/run', { name: 'ponytail', model: '--dangerously-skip-permissions' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/skills/pinned', payload: ['ponytail'] })).statusCode).toBe(204)
    expect((await app.inject('/api/skills/pinned')).json()).toEqual(['ponytail'])

    const routine = { name: '아침', skill: 'ponytail', input: '', model: '기본 모델', effort: '기본', enabled: true, schedule: { kind: 'daily', time: '07:30' } }
    const created = await post('/api/routines', routine)
    expect(created.statusCode).toBe(201)
    const rid = created.json().id as string
    expect((await app.inject({ method: 'PUT', url: `/api/routines/${rid}`, payload: { ...routine, name: '아침2' } })).json().name).toBe('아침2')
    expect((await post('/api/routines', { ...routine, schedule: { kind: 'daily', time: '25:00' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'DELETE', url: `/api/routines/${rid}` })).statusCode).toBe(204)
    expect((await app.inject('/api/routines')).json()).toEqual([])
  })
  it('다른 사이트(Origin)나 로컬이 아닌 Host의 요청은 403', async () => {
    const approve = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/api/spec/approve', headers })
    expect((await approve({ origin: 'https://evil.example' })).statusCode).toBe(403)
    expect((await approve({ host: 'evil.example:4317' })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/state', headers: { host: 'rebind.example' } })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/state', headers: { host: '127.0.0.1:4317', origin: 'http://localhost:5173' } })).statusCode).toBe(200)
    expect((await app.inject('/api/state')).statusCode).toBe(200)
  })
  it('returns state, event cursors, saved prompts and human documents', async () => {
    const settings = (await app.inject('/api/agents')).json()
    expect(settings.roles.master).toEqual({ provider: 'claude', model: 'opus' })
    expect(settings.roles.reviewer.provider).toBe('codex')
    const first = await publish()
    const second = await publish()
    expect((await app.inject('/api/state')).json().lastEventId).toBe(second.id)
    expect((await app.inject(`/api/events?after=${first.id}`)).json().map((e: { id: string }) => e.id)).toEqual([second.id])
    await fs.writeFile(join(dir, 'raw/prompts', `${first.id}.txt`), 'prompt')
    await fs.writeFile(join(dir, 'human/note.md'), '# Note')
    expect((await app.inject(`/api/prompts/${first.id}`)).body).toBe('prompt')
    expect((await app.inject('/api/human/note.md')).body).toBe('# Note')
    expect((await app.inject('/api/human/missing.md')).statusCode).toBe(404)
  })
  it.each(['..%2F..%2Fraw%2Fevents.jsonl', '..%5Craw%5Cevents.jsonl', '%00.md', 'C%3A%5Csecret.md'])(
    'rejects invalid human paths: %s', async (path) => {
      expect((await app.inject(`/api/human/${path}`)).statusCode).toBe(400)
    },
  )
  it('rejects invalid input and invalid workflow actions', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: {} })).statusCode).toBe(400)
    expect((await app.inject('/api/events?after=invalid')).statusCode).toBe(400)
    expect((await app.inject('/api/prompts/..%5Csecret')).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/spec/approve' })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/api/human/msg-0001', payload: { action: 'delete', text: '' } })).statusCode).toBe(400)
  })
  it('chat -> approve starts one background workflow and serves log questions', async () => {
    let release!: () => void
    const run = vi.spyOn(wf, 'runUntilBlocked').mockImplementation(() => new Promise((resolve) => { release = () => resolve('done') }))
    const chat = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: '할 일 앱' } })
    expect(chat.json().specDraft).toBeTruthy()
    expect((await app.inject({ method: 'POST', url: '/api/spec/approve' })).statusCode).toBe(204)
    expect((await app.inject({ method: 'POST', url: '/api/resume' })).statusCode).toBe(204)
    expect(run).toHaveBeenCalledTimes(1)
    expect((await app.inject({ method: 'POST', url: '/api/spec/approve' })).statusCode).toBe(409)
    release()
    expect((await app.inject({ method: 'POST', url: '/api/ask', payload: { question: '왜 멈췄어?' } })).json().answer).toContain('msg-0001')
  })
  it('serves prompts produced by a complete workflow via event id or prompt filename', async () => {
    await wf.chat('앱'); await wf.approveSpec(); await wf.startPipeline()
    expect(await wf.runUntilBlocked()).toBe('done')
    const event = (await wf.store.readEvents()).find((event) => event.promptRef)!
    const filename = event.promptRef!.split('/').at(-1)!.replace(/\.txt$/, '')
    const expected = await fs.readFile(join(dir, event.promptRef!), 'utf8')
    expect((await app.inject(`/api/prompts/${event.id}`)).body).toBe(expected)
    expect((await app.inject(`/api/prompts/${filename}`)).body).toBe(expected)
  })
  it('background failures remain visible and allow a later retry', async () => {
    const run = vi.spyOn(wf, 'runUntilBlocked').mockRejectedValueOnce(new Error('test crash')).mockResolvedValue('done')
    const errors: unknown[] = []
    const drive = createWorkflowDriver(wf, (error) => { errors.push(error) })
    drive(); drive()
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    drive()
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  })
  it('answers human requests and resumes the gate', async () => {
    const event = await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'test', to: 'user', task: 'plan', payload: {} })
    vi.spyOn(wf, 'runUntilBlocked').mockResolvedValue('waiting_human')
    expect((await app.inject({ method: 'POST', url: `/api/human/${event.id}`, payload: { action: 'guidance', text: '계속' } })).statusCode).toBe(204)
    expect(wf.state().humanRequired).toEqual([])
    const resume = vi.spyOn(wf.gate, 'resumeByHuman')
    expect((await app.inject({ method: 'POST', url: '/api/resume' })).statusCode).toBe(204)
    expect(resume).toHaveBeenCalledOnce()
  })
  it('binds loopback and replays SSE before delivering live events; closes active streams', async () => {
    for (let i = 0; i < 45; i++) await wf.bus.publish({ type: 'REPORT', from: 'test', to: 'all', payload: { text: 'x'.repeat(5000) } })
    const address = await listenLocal(app, 0)
    expect(app.server.address()).toMatchObject({ address: '127.0.0.1' })
    const controller = new AbortController()
    const response = await fetch(`${address}/api/stream`, { headers: { 'Last-Event-ID': 'msg-0003' }, signal: controller.signal })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    let text = ''
    const readUntil = async (id: string) => {
      while (!text.includes(`id: ${id}\n`)) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('stream ended early')
        text += new TextDecoder().decode(chunk.value)
      }
    }
    try {
      await readUntil('msg-0045')
      await publish()
      await readUntil('msg-0046')
      expect([...text.matchAll(/^id: (.+)$/gm)].map((m) => m[1])).toEqual(Array.from({ length: 43 }, (_, index) => `msg-${String(index + 4).padStart(4, '0')}`))
      expect(text).toContain('event: envelope\ndata: {')
      await app.close()
    } finally { controller.abort(); await reader.cancel().catch(() => {}) }
  }, 10_000)
  it('GET /api/plan은 plan.json을 돌려주고 없으면 404, 깨졌으면 500', async () => {
    const plan = { tasks: [], testCommands: ['npm test'], devCommand: 'npm run dev' }
    expect((await app.inject('/api/plan')).json()).toEqual({ error: 'plan 없음' })
    expect((await app.inject('/api/plan')).statusCode).toBe(404)
    await fs.writeFile(wf.store.paths.plan, JSON.stringify(plan))
    expect((await app.inject('/api/plan')).json()).toEqual(plan)
    await fs.writeFile(wf.store.paths.plan, '{broken')
    const bad = await app.inject('/api/plan')
    expect(bad.statusCode).toBe(500)
    expect(bad.json().error).toBeTruthy()
  })
  it('dashboardDir를 주면 / 와 SPA 경로에 index.html, /api/* 는 404 유지', async () => {
    const dist = join(dir, 'dist')
    await fs.mkdir(join(dist, 'assets'), { recursive: true })
    await fs.writeFile(join(dist, 'index.html'), '<html>에이전트 관제</html>')
    await fs.writeFile(join(dist, 'assets/a.js'), 'console.log(1)')
    const app2 = buildServer(wf, { dashboardDir: dist })
    try {
      expect((await app2.inject('/')).body).toContain('에이전트 관제')
      expect((await app2.inject('/tasks/t1')).body).toContain('에이전트 관제')
      expect((await app2.inject('/assets/a.js')).body).toBe('console.log(1)')
      expect((await app2.inject('/api/nope')).statusCode).toBe(404)
      expect((await app2.inject({ method: 'POST', url: '/tasks/t1' })).statusCode).toBe(404)
      expect((await app2.inject('/api/state')).json().stage).toBe('INTAKE')
    } finally { await app2.close() }
    expect((await app.inject('/')).statusCode).toBe(404)
  })
  it('notifies human/stage/pause and only the first spec draft', async () => {
    const notify = vi.fn().mockResolvedValue(undefined)
    const detach = attachNotifier(wf.bus, { notify })
    await publish()
    await wf.bus.publish({ type: 'STATE_CHANGE', from: 'test', to: 'all', payload: { taskStatus: 'running' }, task: 't' })
    await wf.bus.publish({ type: 'STATE_CHANGE', from: 'test', to: 'all', payload: { stage: 'INTAKE' } })
    await wf.chat('앱'); await wf.chat('추가 설명')
    await wf.bus.publish({ type: 'PAUSED', from: 'test', to: 'all', payload: {} })
    await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'test', to: 'user', payload: {} })
    expect(notify.mock.calls.map(([e]) => e.type)).toEqual(['STATE_CHANGE', 'CHAT', 'PAUSED', 'HUMAN_REQUIRED'])
    detach(); await publish()
    expect(notify).toHaveBeenCalledTimes(4)
  })
})

describe('프로젝트별 관제 API', () => {
  it('/p/<이름>/api/state, 프로젝트 목록, 표시 이름 수정', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'orch-multi-'))
    await fs.mkdir(join(root, 'main')); await fs.mkdir(join(root, 'other'))
    const main = await Workflow.open(join(root, 'main'), fakeDeps(makeScript()))
    const other = await Workflow.open(join(root, 'other'), fakeDeps(makeScript()))
    const app = buildServer(main, { projects: [{ name: 'other', wf: other, actions: createWorkflowActions(other, () => undefined) }] })
    try {
      expect((await app.inject('/p/main/api/state')).json().stage).toBe('INTAKE')
      expect((await app.inject('/p/other/api/state')).statusCode).toBe(200)
      expect((await app.inject('/api/projects')).json().map((p: { name: string }) => p.name)).toEqual(['main', 'other'])
      const put = await app.inject({ method: 'PUT', url: '/p/other/api/project', payload: { displayName: '두 번째 앱' } })
      expect(put.json()).toEqual({ name: 'other', displayName: '두 번째 앱' })
      expect((await app.inject('/p/other/api/project')).json().displayName).toBe('두 번째 앱')
      expect((await app.inject('/api/project')).json()).toEqual({ name: 'main', displayName: 'main' })
    } finally {
      await app.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
