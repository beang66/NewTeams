import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ProjectStore } from '../../src/store/projectStore.js'
import { tmpDir, rmDir, full } from '../helpers.js'

const sh = promisify(execFile)
let base: string
let root: string
let store: ProjectStore
beforeEach(async () => { base = await tmpDir(); root = join(base, 'proj'); store = new ProjectStore(root) })
afterEach(async () => { vi.restoreAllMocks(); await rmDir(base) })

describe('ProjectStore', () => {
  it('init은 스펙 §6 폴더를 만든다', async () => {
    await store.init()
    for (const d of ['workspace', 'human/iterations', 'human/evidence', 'human/wiki', 'raw/prompts', 'raw/sessions']) expect(existsSync(join(root, d))).toBe(true)
  })

  it('init은 멱등이고 두 저장소와 .gitignore를 만든다', async () => {
    await store.init(); await store.init()
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(existsSync(join(root, 'workspace', '.git'))).toBe(true)
    const gi = await fs.readFile(join(root, '.gitignore'), 'utf8')
    expect(gi).toContain('raw/'); expect(gi).toContain('workspace/')
    const { stdout } = await sh('git', ['log', '--oneline'], { cwd: join(root, 'workspace') })
    expect(stdout.trim().split('\n')).toHaveLength(1)
  })

  it('paths 키', () => {
    expect(Object.keys(store.paths).sort()).toEqual(['events', 'evidence', 'human', 'iterations', 'plan', 'prompts', 'raw', 'sessions', 'state', 'wiki', 'workspace'])
    expect(store.paths.state).toBe(join(root, 'state.json'))
    expect(store.paths.plan).toBe(join(root, 'plan.json'))
  })

  it('잘린 마지막 줄은 건너뛰고 다음 쓰기는 새 줄에서 시작', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await store.init()
    await store.appendEvent(full('msg-0001'))
    await fs.appendFile(store.paths.events, '{"id":"msg-0002","ts":')
    expect((await store.readEvents()).map(e => e.id)).toEqual(['msg-0001'])
    expect(warn).toHaveBeenCalled()
    await store.appendEvent(full('msg-0003'))
    expect((await store.readEvents()).map(e => e.id)).toEqual(['msg-0001', 'msg-0003'])
  })

  it('이벤트 파일이 없으면 빈 배열', async () => {
    expect(await store.readEvents()).toEqual([])
  })

  it('writePrompt / sessionLogPath / writeHuman', async () => {
    await store.init()
    expect(await store.writePrompt('msg-0001', 'hi')).toBe('raw/prompts/msg-0001.txt')
    expect(await fs.readFile(join(root, 'raw/prompts/msg-0001.txt'), 'utf8')).toBe('hi')
    expect(store.sessionLogPath('codex', 't1')).toBe(join(root, 'raw/sessions/codex-t1.jsonl'))
    expect(store.sessionLogPath('claude')).toBe(join(root, 'raw/sessions/claude-main.jsonl'))
    await store.writeHuman('wiki/a/b.md', 'x')
    expect(await fs.readFile(join(root, 'human/wiki/a/b.md'), 'utf8')).toBe('x')
  })

  it('commitHuman은 다른 staged 파일을 커밋에 끌어들이지 않는다', async () => {
    await store.init()
    await store.writeHuman('note.md', 'human')
    await fs.writeFile(join(root, 'other.txt'), 'other')
    await sh('git', ['add', 'other.txt'], { cwd: root })
    await store.commitHuman('human only')
    const files = (await sh('git', ['show', '--format=', '--name-only', 'HEAD'], { cwd: root })).stdout.trim()
    expect(files).toBe('human/note.md')
    expect((await sh('git', ['diff', '--cached', '--name-only'], { cwd: root })).stdout.trim()).toBe('other.txt')
  })

  it('commitHuman은 human/·plan.json만 커밋하고 변경이 없으면 아무것도 안 함', async () => {
    await store.init()
    await store.commitHuman('empty')
    await store.writeHuman('wiki/a.md', 'x')
    await fs.writeFile(store.paths.plan, '{}')
    await fs.writeFile(join(root, 'other.txt'), 'o')
    await store.commitHuman('first')
    await store.commitHuman('again')
    const { stdout } = await sh('git', ['log', '--format=%s'], { cwd: root })
    expect(stdout.trim().split('\n')).toEqual(['first'])
    const files = (await sh('git', ['ls-files'], { cwd: root })).stdout.trim().split('\n').sort()
    expect(files).toEqual(['human/wiki/a.md', 'plan.json'])
  })
})
