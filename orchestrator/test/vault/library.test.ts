import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Workflow } from '../../src/engine/workflow.js'
import { buildServer } from '../../src/server/http.js'
import { Library, parse } from '../../src/vault/library.js'
import { Vault, VaultError } from '../../src/vault/vault.js'
import { fakeDeps, makeScript } from '../fixtures/scripts/common.js'

let root: string
let lib: Library
const input = { title: '보조 로고', status: '사용 중', kind: '로고', tags: ['svg'], body: '# 보조 로고\n흰 배경용' }

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'orch-lib-'))
  lib = new Library(root)
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('Library', () => {
  it('만들기 → 목록 → 읽기 → 고치기 → 삭제(휴지통으로)', async () => {
    const made = await lib.create('brand', input)
    expect(made).toMatchObject({ file: '보조-로고.md', title: '보조 로고', kind: '로고', tags: ['svg'], body: '# 보조 로고\n흰 배경용' })
    expect(await fs.readFile(join(root, 'Libraries/brand/보조-로고.md'), 'utf8')).toContain('status: "사용 중"')
    expect(await lib.list('brand')).toHaveLength(1)
    expect(await lib.list('content')).toHaveLength(0)
    const next = await lib.update('brand', made.file, { ...input, status: '보관', mtimeMs: made.mtimeMs })
    expect(next.status).toBe('보관')
    await lib.remove('brand', made.file)
    expect(await lib.list('brand')).toHaveLength(0)
    expect(await fs.readdir(join(root, 'Libraries/.trash'))).toHaveLength(1)
  })

  it('같은 이름 만들기와 바뀐 노트 고치기는 409', async () => {
    const made = await lib.create('ideas', input)
    await expect(lib.create('ideas', input)).rejects.toMatchObject({ status: 409 })
    await expect(lib.update('ideas', made.file, { ...input, mtimeMs: made.mtimeMs - 5000 })).rejects.toMatchObject({ status: 409 })
  })

  it('세 폴더 밖·숨김·하위 경로는 거부', async () => {
    await fs.writeFile(join(root, 'secret.md'), 'x')
    for (const file of ['../secret.md', '..\\secret.md', '.hidden.md', 'a/b.md', 'note.txt']) {
      await expect(lib.get('brand', file)).rejects.toBeInstanceOf(VaultError)
    }
    await expect(lib.list('wiki' as never)).rejects.toMatchObject({ status: 400 })
  })

  it('frontmatter 값에 줄바꿈을 넣어도 키가 생기지 않는다', async () => {
    const made = await lib.create('content', { ...input, title: 'a\nstatus: hacked', status: '초안' })
    expect(made.status).toBe('초안')
    expect(parse('---\ntitle: 손으로 쓴 제목\ntags: [a, b]\n---\n본문').meta).toEqual({ title: '손으로 쓴 제목', tags: ['a', 'b'] })
  })
})

describe('라이브러리 API', () => {
  let app: FastifyInstance
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'orch-lib-run-'))
    await fs.mkdir(join(root, 'wiki'), { recursive: true })
    const vault = new Vault({ root, read: ['wiki'], inbox: 'AI Inbox' })
    app = buildServer(await Workflow.open(dir, fakeDeps(makeScript())), { vault })
  })
  afterEach(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })

  it('CRUD와 경로·종류 검사', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/library/brand', payload: input })
    expect(res.statusCode).toBe(201)
    const { file, mtimeMs } = res.json()
    const url = `/api/library/brand/${encodeURIComponent(file)}`
    expect((await app.inject(url)).json().body).toBe(input.body)
    expect((await app.inject({ method: 'PUT', url, payload: { ...input, mtimeMs: 1 } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT', url, payload: { ...input, mtimeMs } })).statusCode).toBe(200)
    expect((await app.inject('/api/library/wiki')).statusCode).toBe(400)
    expect((await app.inject(`/api/library/brand/${encodeURIComponent('../x.md')}`)).statusCode).toBe(400)
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(204)
  })
})
