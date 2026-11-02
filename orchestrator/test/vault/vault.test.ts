import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Workflow } from '../../src/engine/workflow.js'
import { buildServer } from '../../src/server/http.js'
import { Vault, VaultError } from '../../src/vault/vault.js'
import { resolveConfig } from '../../src/config.js'
import { fakeDeps, makeScript } from '../fixtures/scripts/common.js'

const INBOX = '01 Projects/P/AI Inbox'
let root: string
let vault: Vault

async function put(rel: string, text: string) {
  await fs.mkdir(join(root, rel, '..'), { recursive: true })
  await fs.writeFile(join(root, rel), text)
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'orch-vault-'))
  await put('01 Projects/P/plan.md', '---\ntitle: x\n---\n# 계획\n대시보드 세컨드 브레인 연결 계획')
  await put('01 Projects/P/notes.txt', 'not markdown')
  await put('wiki/concepts/Harness.md', '하네스는 검증을 강제한다')
  await put('wiki/sources/S1.md', '출처 노트')
  await put('wiki/index.md', '색인')
  await put(`${INBOX}/old.md`, '세컨드 브레인 결과물')
  await put('00 Me/About Me.md', '세컨드 브레인 개인 정보')
  await put('03 Resources/r.md', '세컨드 브레인 원본')
  await put('.obsidian/workspace.md', '세컨드 브레인')
  vault = new Vault({ root, read: ['01 Projects', 'wiki'], inbox: INBOX, cacheMs: 0 })
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('Vault', () => {
  it('허용 폴더의 Markdown만 분류해 센다(AI Inbox·숨김·제외 폴더 제외)', async () => {
    const s = await vault.summary()
    expect(s.total).toBe(4)
    expect(Object.fromEntries(s.groups.map((g) => [g.key, g.count]))).toEqual({ projects: 1, concepts: 1, sources: 1, wiki: 1 })
    expect(s.inboxCount).toBe(1)
  })

  it('검색은 허용 폴더 안에서만 찾고 제목 일치를 먼저 보여 준다', async () => {
    const hits = await vault.search('세컨드 브레인')
    expect(hits.map((h) => h.path)).toEqual(['01 Projects/P/plan.md'])
    expect(hits[0]!.snippet).toContain('세컨드 브레인')
    expect((await vault.search('harness')).map((h) => h.path)).toEqual(['wiki/concepts/Harness.md'])
    expect(await vault.search('출처', 20, 'concepts')).toEqual([])
  })

  it.each([
    ['00 Me/About Me.md', 403],
    ['03 Resources/r.md', 403],
    [`${INBOX}/old.md`, 403],
    ['01 Projects/../00 Me/About Me.md', 403],
    ['.obsidian/workspace.md', 403],
    ['/etc/passwd.md', 403],
    ['01 Projects/P/notes.txt', 400],
    ['01 Projects/P/missing.md', 404],
  ])('노트 읽기 경계: %s → %i', async (path, status) => {
    await expect(vault.note(path)).rejects.toMatchObject({ status })
  })

  it('허용 폴더 안의 심볼릭 링크로 밖을 읽을 수 없다', async (ctx) => {
    try {
      await fs.symlink(join(root, '00 Me'), join(root, 'wiki', 'me'))
    } catch (e) {
      // Windows는 관리자 권한·개발자 모드 없이 심볼릭 링크를 만들 수 없다. 다른 OS에서는 그대로 검사한다.
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip()
      throw e
    }
    await expect(vault.note('wiki/me/About Me.md')).rejects.toBeInstanceOf(VaultError)
    expect((await vault.summary()).total).toBe(4)
  })

  it('그래프: 노트는 점, [[링크]]와 [텍스트](경로.md)는 선. 허용 밖·없는 노트·자기 자신 링크는 뺀다', async () => {
    await put('wiki/concepts/A.md', '[[Harness]] [[Harness|별칭]] [[wiki/sources/S1#근거]] [[About Me]] [[없음]] [[A]] [색인](../index.md)')
    const g = await vault.graph()
    expect(g.nodes).toHaveLength(5)
    const pairs = g.links.map((l) => [l.source, l.target].sort().join(' — ')).sort()
    expect(pairs).toEqual([
      'wiki/concepts/A.md — wiki/concepts/Harness.md',
      'wiki/concepts/A.md — wiki/index.md',
      'wiki/concepts/A.md — wiki/sources/S1.md',
    ])
    expect(g.nodes.find((n) => n.id === 'wiki/concepts/A.md')!.degree).toBe(3)
  })

  it('그래프: 폴더 이름에 대괄호([진행])가 있어도 링크를 읽는다', async () => {
    await put('01 Projects/[진행] P/허브.md', '허브')
    await put('wiki/concepts/A.md', '[[01 Projects/[진행] P/허브]] [[01 Projects/[진행] P/허브#절|별칭]] [[Harness]]')
    const pairs = (await vault.graph()).links.map((l) => [l.source, l.target].sort().join(' — ')).sort()
    expect(pairs).toEqual([
      '01 Projects/[진행] P/허브.md — wiki/concepts/A.md',
      'wiki/concepts/A.md — wiki/concepts/Harness.md',
    ])
  })

  it('AI Inbox에 새 파일로 쓰고, 같은 이름은 덮어쓰지 않는다', async () => {
    const now = new Date('2026-11-01T01:02:03Z')
    const { path } = await vault.writeInbox({ title: '주간 회고', body: '본문', project: 'P', runId: 'run-1', sources: ['wiki/concepts/Harness.md'] }, now)
    expect(path).toBe(`${INBOX}/2026-11-01-100203-주간-회고-run-1.md`)
    const text = await fs.readFile(join(root, path), 'utf8')
    expect(text).toContain('created: 2026-11-01T10:02:03+09:00')
    expect(text).toContain('"[[wiki/concepts/Harness]]"')
    await expect(vault.writeInbox({ title: '주간 회고', body: '다른 본문', runId: 'run-1' }, now)).rejects.toMatchObject({ status: 409 })
    expect(await fs.readFile(join(root, path), 'utf8')).toBe(text)
  })

  it('출처에 따옴표·줄바꿈이 있어도 frontmatter에 새 키가 생기지 않는다', async () => {
    const { path } = await vault.writeInbox({ title: 't', body: 'b', sources: ['a"\nevil: x'] }, new Date('2026-11-01T01:02:03Z'))
    const text = await fs.readFile(join(root, path), 'utf8')
    expect(text).not.toMatch(/^evil:/m)
    expect(text).toContain('"[[a\\"\\nevil: x]]"')
  })
})

describe('Vault HTTP', { timeout: 30_000 }, () => {
  let dir: string
  let app: FastifyInstance
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'orch-vault-http-'))
    app = buildServer(await Workflow.open(dir, fakeDeps(makeScript())), { vault })
  })
  afterEach(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })

  it('요약·검색·노트·Inbox 쓰기', async () => {
    expect((await app.inject('/api/vault')).json()).toMatchObject({ state: 'connected', total: 4 })
    expect((await app.inject('/api/vault/graph')).json().nodes).toHaveLength(4)
    const q = encodeURIComponent('세컨드')
    expect((await app.inject(`/api/vault/search?q=${q}`)).json()).toHaveLength(1)
    expect((await app.inject(`/api/vault/note?path=${encodeURIComponent('wiki/index.md')}`)).json().content).toBe('색인')
    expect((await app.inject(`/api/vault/note?path=${encodeURIComponent('00 Me/About Me.md')}`)).statusCode).toBe(403)
    const res = await app.inject({ method: 'POST', url: '/api/vault/inbox', payload: { title: 't', body: 'b' } })
    expect(res.statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: '/api/vault/inbox', payload: { title: 't' } })).statusCode).toBe(400)
  })

  it('연결하지 않으면 off', async () => {
    const off = buildServer(await Workflow.open(dir, fakeDeps(makeScript())))
    expect((await off.inject('/api/vault')).json()).toEqual({ state: 'off' })
    await off.close()
  })
})

it('vault 설정 기본값과 검증', () => {
  expect(resolveConfig({}).vault).toEqual({ path: join(homedir(), 'Documents', 'Obsidian Vault'), github: 'https://github.com/beang66/Vault', read: ['01 Projects', 'wiki'], inbox: '01 Projects/[진행] NEWTEAMs AI Agent Studio/AI Inbox', pipeline: '01 Projects/[진행] NEWTEAMs AI Agent Studio/파이프라인', graph: 'wiki/전문가 그래프' })
  expect(resolveConfig({ vault: { path: 'C:/V' } as never }).vault.path).toBe('C:/V')
  expect(() => resolveConfig({ vault: { read: [] } as never })).toThrow(/vault 설정 오류/)
})
