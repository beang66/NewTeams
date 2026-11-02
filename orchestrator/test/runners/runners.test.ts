import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { ClaudeRunner } from '../../src/runners/claudeRunner.js'
import { CodexRunner } from '../../src/runners/codexRunner.js'
import { FakeRunner } from '../../src/runners/fakeRunner.js'
import { OpenAIRunner } from '../../src/runners/openaiRunner.js'
import { RunnerError, type RunRequest, type RunResult } from '../../src/runners/types.js'
import { rmDir, tmpDir } from '../helpers.js'

const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'bin')
const fakeMjs = join(binDir, 'fake-cli.mjs')

let root: string
let fakeCliCmd: string
let argsFile: string
let req: RunRequest
const lastArgs = (): string[] => JSON.parse(readFileSync(argsFile, 'utf8'))
const ok = (text: string): RunResult => ({ text, usage: { in: 1, out: 1, cached: 0 } })

beforeAll(async () => {
  root = await tmpDir()
  const wrapDir = join(root, 'bin')
  mkdirSync(wrapDir)
  if (process.platform === 'win32') {
    fakeCliCmd = join(wrapDir, 'fake-cli.cmd')
    writeFileSync(fakeCliCmd, `@node "${fakeMjs}" %*\r\n`)
  } else {
    fakeCliCmd = join(wrapDir, 'fake-cli.sh')
    writeFileSync(fakeCliCmd, `#!/bin/sh\nexec node "${fakeMjs}" "$@"\n`)
    chmodSync(fakeCliCmd, 0o755)
  }
  argsFile = join(root, 'args.json')
  process.env.FAKE_ARGS_FILE = argsFile
})
afterAll(async () => { delete process.env.FAKE_ARGS_FILE; delete process.env.FAKE_MODE; await rmDir(root) })
beforeEach(() => {
  delete process.env.FAKE_MODE
  req = { role: 'dev', prompt: '안녕 hello', model: 'sonnet', cwd: root, timeoutMs: 15_000, rawLogPath: join(root, 'raw', 'sessions', `${Math.random()}.jsonl`) }
})

describe('ClaudeRunner', () => {
  const mk = () => new ClaudeRunner({ ...DEFAULT_CONFIG, claudeBin: fakeCliCmd })
  it('resume/fork 인자를 만들고 raw 로그를 남긴다', async () => {
    const res = await mk().run({ ...req, resumeSessionId: 'seed-1', fork: true })
    expect(lastArgs()).toEqual(expect.arrayContaining(['--resume', 'seed-1', '--fork-session', '--model', 'sonnet']))
    expect(lastArgs()).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose']))
    expect(readFileSync(req.rawLogPath, 'utf8')).toContain('"type":"result"')
    expect(res.sessionId).toBe('s-1')
    expect(res.usage.out).toBe(7)
    expect(res.text).toMatch(/^\d+:[0-9a-f]{64}$/)
  })
  it('permission-mode는 dev/qa만, allowedTools는 쉼표로, 프롬프트는 argv에 없다', async () => {
    await mk().run({ ...req, role: 'qa', allowedTools: ['Read', 'Bash'], addDirs: ['a', 'b'], mcpConfig: 'm.json' })
    const a = lastArgs()
    expect(a).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Bash', '--mcp-config', 'm.json']))
    expect(a.filter((x) => x === '--add-dir')).toHaveLength(2)
    expect(a.join(' ')).not.toContain('hello')
    await mk().run({ ...req, role: 'reviewer' })
    expect(lastArgs()).not.toContain('--permission-mode')
  })
  it('사용자 전역 설정(플러그인·훅·MCP)을 싣지 않는다', async () => {
    await mk().run(req)
    const a = lastArgs()
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('project,local')
    expect(a).toContain('--strict-mcp-config')
    await mk().run({ ...req, userSettings: true, effort: 'high' })
    const s = lastArgs()
    expect(s).not.toContain('--setting-sources')
    expect(s).not.toContain('--strict-mcp-config')
    expect(s[s.indexOf('--effort') + 1]).toBe('high')
  })
  it('default 모델은 CLI 기본값을 사용한다', async () => {
    await mk().run({ ...req, model: 'default' })
    expect(lastArgs()).not.toContain('--model')
  })
  it('JSON이 아닌 줄이 섞여도 파싱한다', async () => {
    process.env.FAKE_MODE = 'noise'
    expect((await mk().run(req)).sessionId).toBe('s-1')
  })
  it('한도 도달은 rate_limit + resetAt', async () => {
    process.env.FAKE_MODE = 'limit'
    await expect(mk().run(req)).rejects.toMatchObject({ kind: 'rate_limit', resetAt: new Date('2026-10-27T05:00:00Z') })
  })
  it('exit 1 한도 응답도 구조화된 resetsAt을 사용한다', async () => {
    process.env.FAKE_MODE = 'session-limit'
    await expect(mk().run(req)).rejects.toMatchObject({ kind: 'rate_limit', resetAt: new Date('2026-10-27T05:30:00Z') })
  })
  it('결과 줄이 없으면 format', async () => {
    process.env.FAKE_MODE = 'noresult'
    await expect(mk().run(req)).rejects.toMatchObject({ kind: 'format' })
  })
  it('시간 초과는 timeout', async () => {
    process.env.FAKE_MODE = 'sleep'
    await expect(mk().run({ ...req, timeoutMs: 300 })).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('CodexRunner', () => {
  const mk = () => new CodexRunner({ ...DEFAULT_CONFIG, codexBin: fakeCliCmd })
  it('항상 read-only 샌드박스, 마지막 인자는 -', async () => {
    const res = await mk().run({ ...req, role: 'reviewer' })
    const a = lastArgs()
    expect(a).toEqual(expect.arrayContaining(['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', root]))
    expect(a.at(-1)).toBe('-')
    expect(res.sessionId).toBe('t-1')
    expect(readFileSync(req.rawLogPath, 'utf8')).toContain('thread.started')
  })
  it('작업은 workspace-write, 지정 모델과 seed fork 및 resume을 사용한다', async () => {
    await mk().run({ ...req, role: 'dev', model: 'custom-codex', resumeSessionId: 'seed-id', fork: true, addDirs: [join(root, 'evidence')] })
    expect(lastArgs()).toEqual(expect.arrayContaining(['--approve-for-me', '--model', 'custom-codex', 'fork', 'seed-id']))
    expect(lastArgs()).not.toContain('--sandbox')
    expect(lastArgs()).toEqual(expect.arrayContaining(['--add-dir', join(root, 'evidence')]))
    await mk().run({ ...req, role: 'reviewer', model: 'codex-default', resumeSessionId: 'review-id' })
    expect(lastArgs()).toEqual(expect.arrayContaining(['--sandbox', 'read-only', 'resume', 'review-id']))
    expect(lastArgs()).not.toContain('--model')
    expect(lastArgs()).not.toContain('--approve-for-me')
  })
  it('이미지와 output-schema 임시파일을 쓰고 끝나면 지운다', async () => {
    const count = () => readdirSync(os.tmpdir()).filter((f) => f.includes('codex-schema')).length
    const before = count()
    await mk().run({ ...req, images: ['a.png', 'b.png'], outputSchema: { type: 'object' } })
    const a = lastArgs()
    expect(a.filter((x) => x === '-i')).toHaveLength(2)
    const schemaPath = a[a.indexOf('--output-schema') + 1]!
    expect(existsSync(schemaPath)).toBe(false)
    expect(count()).toBe(before)
  })
  it('이어가기에서는 이미지와 output-schema를 resume 하위 명령 옵션으로 넘긴다', async () => {
    await mk().run({ ...req, resumeSessionId: 'review-id', images: ['a.png'], outputSchema: { type: 'object' } })
    const a = lastArgs()
    const at = a.indexOf('resume')
    expect(at).toBeGreaterThan(a.indexOf('--sandbox'))
    expect(a.indexOf('-i')).toBeGreaterThan(at)
    expect(a.indexOf('--output-schema')).toBeGreaterThan(at)
    expect(a.slice(-2)).toEqual(['review-id', '-'])
  })
  it('turn.failed/종료 코드 실패는 classifyFailure로 분류 (format 아님)', async () => {
    process.env.FAKE_MODE = 'codexfail'
    await expect(mk().run(req)).rejects.toMatchObject({ kind: 'rate_limit' })
  })
  it('시간 초과는 timeout', async () => {
    process.env.FAKE_MODE = 'sleep'
    await expect(mk().run({ ...req, timeoutMs: 300 })).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('OpenAIRunner', () => {
  const resp = { output_text: '{"a":1}', usage: { input_tokens: 1_000_000, output_tokens: 500_000, input_tokens_details: { cached_tokens: 0 } } }
  const stub = (create: unknown) => ({ responses: { create } }) as any
  const savedKey = process.env.OPENAI_API_KEY
  afterAll(() => { if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey })

  it('캡 도달 시 호출하지 않는다', async () => {
    const create = vi.fn()
    const r = new OpenAIRunner(DEFAULT_CONFIG, { get: () => 8, add: vi.fn() }, stub(create))
    await expect(r.run(req)).rejects.toMatchObject({ kind: 'rate_limit', message: 'openai cap' })
    expect(create).not.toHaveBeenCalled()
  })
  it('키가 없으면 auth', async () => {
    delete process.env.OPENAI_API_KEY
    const r = new OpenAIRunner(DEFAULT_CONFIG, { get: () => 0, add: vi.fn() }, stub(vi.fn()))
    await expect(r.run(req)).rejects.toMatchObject({ kind: 'auth', message: 'OPENAI_API_KEY not set' })
  })
  it('비용을 계산해 spend.add에 넘기고 raw 로그에 응답을 남긴다', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const add = vi.fn().mockResolvedValue(undefined)
    const create = vi.fn().mockResolvedValue(resp)
    const png = join(root, 'p.png'); writeFileSync(png, Buffer.from([1, 2, 3]))
    const r = new OpenAIRunner(DEFAULT_CONFIG, { get: () => 0, add }, stub(create))
    const res = await r.run({ ...req, images: [png], outputSchema: { type: 'object', properties: {}, additionalProperties: false } })
    expect(res.text).toBe('{"a":1}')
    expect(res.usage).toMatchObject({ in: 1_000_000, out: 500_000 })
    expect(add).toHaveBeenCalledWith(0.25 + 1.0)
    const body = create.mock.calls[0]![0]
    expect(body.model).toBe(DEFAULT_CONFIG.openaiModel)
    expect(JSON.stringify(body.input)).toContain('data:image/png;base64,AQID')
    expect(body.text.format.type).toBe('json_schema')
    expect(readFileSync(req.rawLogPath, 'utf8').trim().split('\n')).toHaveLength(1)
  })
  it.each([
    [404, 'crash', 'openai model not found: gpt-5-mini'],
    [429, 'rate_limit', undefined],
    [401, 'auth', undefined],
  ])('HTTP %i 매핑', async (status, kind, msg) => {
    process.env.OPENAI_API_KEY = 'test-key'
    const create = vi.fn().mockRejectedValue(Object.assign(new Error(`http ${status}`), { status }))
    const r = new OpenAIRunner(DEFAULT_CONFIG, { get: () => 0, add: vi.fn() }, stub(create))
    const p = r.run(req)
    await expect(p).rejects.toMatchObject({ kind })
    if (msg) await expect(r.run(req)).rejects.toMatchObject({ message: msg })
  })
})

describe('FakeRunner', () => {
  it('스크립트 순서대로 반환하고 호출을 기록', async () => {
    const f = new FakeRunner([ok('a'), new RunnerError('timeout', 't'), (q) => ok(q.prompt)])
    expect((await f.run(req)).text).toBe('a')
    await expect(f.run(req)).rejects.toMatchObject({ kind: 'timeout' })
    expect((await f.run(req)).text).toBe(req.prompt)
    expect(f.calls).toHaveLength(3)
    await expect(f.run(req)).rejects.toThrow(/3/)
  })
  it('calls는 요청의 복사본', async () => {
    const f = new FakeRunner([ok('a')])
    const r = { ...req }
    await f.run(r); r.prompt = 'changed'
    expect(f.calls[0]!.prompt).toBe(req.prompt)
  })
})
