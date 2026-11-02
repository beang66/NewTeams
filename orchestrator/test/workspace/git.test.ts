import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ensureRepo, createWorktree, commitAll, changedFiles, diff, headRev,
  lastCommitAt, mergeTask, removeWorktree, currentBranch, firstCommit, settleMerge,
} from '../../src/workspace/git.js'

const execFileP = promisify(execFile)

async function gitStatusPorcelain(dir: string): Promise<string> {
  const { stdout } = await execFileP('git', ['status', '--porcelain'], { cwd: dir })
  return stdout.trim()
}
async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd: dir })
  return stdout.trim()
}

let root: string
let repo: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orch-git-'))
  repo = join(root, 'workspace')
  await import('node:fs/promises').then((f) => f.mkdir(repo))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('git workspace', () => {
  it('ensureRepo는 멱등이고 .gitignore에 .worktrees/를 넣는다', async () => {
    await ensureRepo(repo)
    const first = await headRev(repo)
    await ensureRepo(repo)
    expect(await headRev(repo)).toBe(first)
    expect(await readFile(join(repo, '.gitignore'), 'utf8')).toContain('.worktrees/')
    await import('node:fs/promises').then((fs) => fs.mkdir(join(repo, '.playwright-mcp')))
    await writeFile(join(repo, '.playwright-mcp', 'snapshot.yml'), 'runtime browser snapshot')
    expect(await gitStatusPorcelain(repo)).toBe('')
  })

  it('커밋 없는 저장소에도 초기 커밋을 만든다', async () => {
    await execFileP('git', ['init'], { cwd: repo })
    await ensureRepo(repo)
    expect(await headRev(repo)).toMatch(/^[0-9a-f]{40}$/)
  })

  it('worktree에서 커밋한 변경을 base 기준으로 본다', async () => {
    await ensureRepo(repo)
    const base = await headRev(repo)
    const wt = await createWorktree(repo, 't1')
    expect(wt).toBe(join(repo, '.worktrees', 't1'))
    await writeFile(join(wt, 'a.txt'), 'x')
    expect(await commitAll(wt, 't1')).toBe(true)
    expect(await changedFiles(wt, base)).toEqual(['a.txt'])
    expect(await commitAll(wt, 'nothing')).toBe(false)
    expect(await git(wt, 'branch', '--show-current')).toBe('task/t1')
    expect(Math.abs(Date.now() - (await lastCommitAt(wt)).getTime())).toBeLessThan(60_000)
  })

  it('createWorktree는 이미 있으면 경로를 그대로 돌려준다', async () => {
    await ensureRepo(repo)
    const a = await createWorktree(repo, 't1')
    await writeFile(join(a, 'a.txt'), 'x')
    const b = await createWorktree(repo, 't1')
    expect(b).toBe(a)
    expect(existsSync(join(b, 'a.txt'))).toBe(true)
  })

  it('changedFiles는 정렬된 슬래시 경로를 준다', async () => {
    await ensureRepo(repo)
    const base = await headRev(repo)
    const wt = await createWorktree(repo, 't1')
    await import('node:fs/promises').then((f) => f.mkdir(join(wt, 'src'), { recursive: true }))
    await writeFile(join(wt, 'src', 'b.ts'), '1')
    await writeFile(join(wt, 'a.txt'), '1')
    await commitAll(wt, 'x')
    expect(await changedFiles(wt, base)).toEqual(['a.txt', 'src/b.ts'])
  })

  it('비ASCII 파일명이 이스케이프되지 않는다', async () => {
    await ensureRepo(repo)
    const base = await headRev(repo)
    const wt = await createWorktree(repo, 't1')
    await writeFile(join(wt, '한글.txt'), '1')
    await commitAll(wt, 'k')
    expect(await changedFiles(wt, base)).toEqual(['한글.txt'])
  })

  it('ensureRepo는 기존 untracked 파일을 커밋하지 않는다', async () => {
    await execFileP('git', ['init', '-b', 'main'], { cwd: repo })
    await writeFile(join(repo, 'x.txt'), 'x')
    await ensureRepo(repo)
    expect(await gitStatusPorcelain(repo)).toBe('?? x.txt')
  })

  it('충돌하면 ok=false, 충돌 파일, 저장소는 깨끗', async () => {
    await ensureRepo(repo)
    await writeFile(join(repo, 'same.txt'), 'orig\n')
    await commitAll(repo, 'seed')
    const w1 = await createWorktree(repo, 't1')
    const w2 = await createWorktree(repo, 't2')
    await writeFile(join(w1, 'same.txt'), 'one\n')
    await commitAll(w1, 't1')
    await writeFile(join(w2, 'same.txt'), 'two\n')
    await commitAll(w2, 't2')
    expect((await mergeTask(repo, 't1')).ok).toBe(true)
    expect(await mergeTask(repo, 't2')).toEqual({ ok: false, conflicts: ['same.txt'] })
    expect(await gitStatusPorcelain(repo)).toBe('')
  })

  it('settleMerge: 미해결 충돌이면 병합을 취소, 해결됐으면 커밋 — 이후 mergeTask 성공', async () => {
    await ensureRepo(repo)
    const first = await firstCommit(repo)
    expect(await git(repo, 'log', '--format=%s', '-1', first)).toBe('initial commit')
    await writeFile(join(repo, 'same.txt'), 'orig\n')
    await commitAll(repo, 'seed')
    const w1 = await createWorktree(repo, 't1')
    const w2 = await createWorktree(repo, 't2')
    await writeFile(join(w1, 'same.txt'), 'one\n'); await commitAll(w1, 't1')
    await writeFile(join(w2, 'same.txt'), 'two\n'); await commitAll(w2, 't2')
    expect((await mergeTask(repo, 't1')).ok).toBe(true)
    const main = await currentBranch(repo)
    await execFileP('git', ['merge', main], { cwd: w2 }).catch(() => undefined)
    expect(await settleMerge(w2, 'resolve')).toBe(false)
    expect(await gitStatusPorcelain(w2)).toBe('')
    await execFileP('git', ['merge', main], { cwd: w2 }).catch(() => undefined)
    await writeFile(join(w2, 'same.txt'), 'both\n')
    await execFileP('git', ['add', 'same.txt'], { cwd: w2 })
    expect(await settleMerge(w2, 'resolve')).toBe(true)
    expect(await mergeTask(repo, 't2')).toEqual({ ok: true, conflicts: [] })
    expect((await readFile(join(repo, 'same.txt'), 'utf8')).trim()).toBe('both')
  })

  it('diff는 maxChars로 자른다', async () => {
    await ensureRepo(repo)
    const base = await headRev(repo)
    const wt = await createWorktree(repo, 't1')
    await writeFile(join(wt, 'big.txt'), 'y'.repeat(5000))
    await commitAll(wt, 'big')
    const d = await diff(wt, base, 100)
    expect(d).toContain('…(diff 일부 생략)')
    expect(d).toContain('- big.txt')
    const full = await diff(wt, base)
    expect(full).toContain('big.txt')
    expect(full).not.toContain('(diff 일부 생략)')
  })

  it('diff는 잠금 파일을 빼고, 잘리면 못 본 파일을 모두 알려 준다', async () => {
    await ensureRepo(repo)
    const base = await headRev(repo)
    const wt = await createWorktree(repo, 't1')
    await writeFile(join(wt, 'package-lock.json'), 'x\n'.repeat(5000))
    await writeFile(join(wt, 'a.ts'), 'a'.repeat(300))
    await writeFile(join(wt, 'b.ts'), 'b'.repeat(300))
    await commitAll(wt, 'deps')
    const full = await diff(wt, base)
    expect(full).not.toContain('package-lock.json')
    expect(full).toContain('diff --git a/a.ts')
    const cut = await diff(wt, base, 200)
    expect(cut).toContain('- a.ts') // 잘린 채 보인 파일
    expect(cut).toContain('- b.ts') // 아예 못 본 파일
    expect(cut).not.toContain('- package-lock.json')
  })

  it('removeWorktree는 워크트리와 브랜치를 지우고 멱등이다', async () => {
    await ensureRepo(repo)
    const wt = await createWorktree(repo, 't1')
    await removeWorktree(repo, 't1')
    expect(existsSync(wt)).toBe(false)
    expect(await git(repo, 'branch', '--list', 'task/t1')).toBe('')
    await expect(removeWorktree(repo, 't1')).resolves.toBeUndefined()
  })
})
