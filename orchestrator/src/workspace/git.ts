import { promises as fs, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${(err.stderr || err.message || '').trim()}`)
  }
}

async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await execFileP('git', args, { cwd })
    return true
  } catch {
    return false
  }
}

const lines = (s: string): string[] =>
  s.split('\n').map((l) => l.trim().replaceAll('\\', '/')).filter(Boolean).sort()

async function setLocalIdentity(dir: string): Promise<void> {
  await git(dir, ['config', 'user.name', 'orchestrator'])
  await git(dir, ['config', 'user.email', 'orchestrator@localhost'])
  await git(dir, ['config', 'core.autocrlf', 'false'])
}

export async function headRev(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

export async function commitAll(dir: string, message: string): Promise<boolean> {
  await git(dir, ['add', '-A'])
  if ((await git(dir, ['status', '--porcelain'])).trim() === '') return false
  await git(dir, ['commit', '-m', message])
  return true
}

export async function ensureRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  if (!existsSync(join(dir, '.git'))) {
    await git(dir, ['init', '-b', 'main'])
    await setLocalIdentity(dir)
  }
  if (!(await gitOk(dir, ['rev-parse', '--verify', 'HEAD']))) {
    await setLocalIdentity(dir)
    await git(dir, ['commit', '--allow-empty', '-m', 'initial commit'])
  }
  const ignorePath = join(dir, '.gitignore')
  const current = existsSync(ignorePath) ? await fs.readFile(ignorePath, 'utf8') : ''
  if (!current.split(/\r?\n/).some((l) => l.trim() === '.worktrees/')) {
    const sep = current === '' || current.endsWith('\n') ? '' : '\n'
    await fs.writeFile(ignorePath, `${current}${sep}.worktrees/\n`)
    await git(dir, ['add', '.gitignore'])
    await git(dir, ['commit', '-m', 'chore: ignore .worktrees', '--', '.gitignore'])
  }
  await ignoreBrowserRuntime(dir)
}

/** Shared local excludes apply to every task worktree without changing application files. */
async function ignoreBrowserRuntime(dir: string): Promise<void> {
  const path = resolve(dir, (await git(dir, ['rev-parse', '--git-path', 'info/exclude'])).trim())
  const current = existsSync(path) ? await fs.readFile(path, 'utf8') : ''
  if (current.split(/\r?\n/).some((line) => line.trim() === '.playwright-mcp/')) return
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.appendFile(path, `${current && !current.endsWith('\n') ? '\n' : ''}.playwright-mcp/\n`)
}

export async function createWorktree(repo: string, taskId: string): Promise<string> {
  const path = join(repo, '.worktrees', taskId)
  if (existsSync(join(path, '.git'))) return path
  await git(repo, ['worktree', 'prune'])
  const branch = `task/${taskId}`
  const branchExists = await gitOk(repo, ['rev-parse', '--verify', `refs/heads/${branch}`])
  await git(repo, branchExists
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '-b', branch, path, 'HEAD'])
  return path
}

export async function changedFiles(dir: string, base: string): Promise<string[]> {
  return lines(await git(dir, ['-c', 'core.quotepath=false', 'diff', '--name-only', `${base}...HEAD`]))
}

export async function diff(dir: string, base: string, maxChars = 60000): Promise<string> {
  const out = await git(dir, ['diff', `${base}...HEAD`])
  return out.length > maxChars ? out.slice(0, maxChars) + '\n…(diff 일부 생략)' : out
}

export async function lastCommitAt(dir: string): Promise<Date> {
  return new Date((await git(dir, ['log', '-1', '--format=%cI'])).trim())
}

export async function mergeTask(repo: string, taskId: string): Promise<{ ok: boolean; conflicts: string[] }> {
  try {
    await execFileP('git', ['merge', '--no-ff', `task/${taskId}`, '-m', `merge ${taskId}`], { cwd: repo })
    return { ok: true, conflicts: [] }
  } catch (e) {
    const conflicts = lines(await git(repo, ['-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=U']))
    await gitOk(repo, ['merge', '--abort'])
    if (conflicts.length === 0) {
      const err = e as { stderr?: string; message?: string }
      throw new Error(`git merge task/${taskId} failed in ${repo}: ${(err.stderr || err.message || '').trim()}`)
    }
    return { ok: false, conflicts }
  }
}

export async function removeWorktree(repo: string, taskId: string): Promise<void> {
  const path = join(repo, '.worktrees', taskId)
  await gitOk(repo, ['worktree', 'remove', '--force', path])
  await fs.rm(path, { recursive: true, force: true, maxRetries: 3 })
  await gitOk(repo, ['worktree', 'prune'])
  const branch = `task/${taskId}`
  if (await gitOk(repo, ['rev-parse', '--verify', `refs/heads/${branch}`])) {
    await git(repo, ['branch', '-D', branch])
  }
}

export async function currentBranch(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/** 저장소의 첫(루트) 커밋. */
export async function firstCommit(dir: string): Promise<string> {
  return (await git(dir, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0]!.trim()
}

/** 충돌 해결 작업 뒤 정리: 아직 unmerged 파일이 있으면 진행 중인 병합을 취소하고 false, 아니면 남은 변경을 커밋하고 true. */
export async function settleMerge(dir: string, message: string): Promise<boolean> {
  const unmerged = lines(await git(dir, ['-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=U']))
  if (unmerged.length) {
    await gitOk(dir, ['merge', '--abort'])
    return false
  }
  await commitAll(dir, message)
  return true
}
