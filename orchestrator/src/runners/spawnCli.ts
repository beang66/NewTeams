import spawn from 'cross-spawn'
import { spawn as nodeSpawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { assertChildStartAllowed, trackOwnedChild } from './ownedChildren.js'

export interface SpawnResult { exitCode: number; stdoutLines: string[]; stderr: string; timedOut: boolean }
export interface SpawnOptions {
  cwd: string; stdin: string; timeoutMs: number
  onLine?: (l: string) => void
  /** process.env 위에 덮어쓸 환경 변수 */
  env?: Record<string, string>
  /** 사람이 중단하면 프로세스 트리를 끝낸다 */
  signal?: AbortSignal
}

function killTree(pid: number | undefined, child: { kill(sig?: NodeJS.Signals): boolean }): void {
  if (process.platform === 'win32' && pid !== undefined) {
    try {
      const k = nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      k.on('error', () => { try { child.kill('SIGKILL') } catch { /* 이미 종료 */ } })
      return
    } catch { /* 아래 폴백 */ }
  }
  try { child.kill('SIGKILL') } catch { /* 이미 종료 */ }
}

/** stdout 줄을 req.rawLogPath에 그대로 추가 기록하는 onLine 콜백을 만든다. */
export function rawLogAppender(path: string): (line: string) => void {
  mkdirSync(dirname(path), { recursive: true })
  return (line) => appendFileSync(path, line + '\n', 'utf8')
}

export async function spawnCli(bin: string, args: string[], o: SpawnOptions): Promise<SpawnResult> {
  assertChildStartAllowed()
  return new Promise((resolve) => {
    const stdoutLines: string[] = []
    let stderr = ''
    let timedOut = false
    let settled = false
    let pending = ''
    let timer: NodeJS.Timeout | undefined
    let graceTimer: NodeJS.Timeout | undefined

    const pushLine = (raw: string): void => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      stdoutLines.push(line)
      o.onLine?.(line)
    }
    const finish = (exitCode: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      if (pending !== '') { pushLine(pending); pending = '' }
      resolve({ exitCode, stdoutLines, stderr, timedOut })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, {
        cwd: o.cwd,
        env: { ...process.env, ...o.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      trackOwnedChild(child)
    } catch (e) {
      stderr = (e as Error).message
      finish(127)
      return
    }

    child.stdout!.setEncoding('utf8')
    child.stderr!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      pending += chunk
      let i: number
      while ((i = pending.indexOf('\n')) >= 0) {
        const l = pending.slice(0, i)
        pending = pending.slice(i + 1)
        pushLine(l)
      }
    })
    child.stderr!.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (e) => { stderr += (stderr ? '\n' : '') + e.message; finish(127) })
    child.on('close', (code) => finish(code ?? 1))
    child.stdin!.on('error', () => { /* 프로세스가 stdin을 닫고 종료 */ })
    child.stdin!.end(o.stdin, 'utf8')

    const stop = (): void => {
      killTree(child.pid, child)
      // 손자 프로세스가 파이프를 붙잡아 close가 오지 않는 경우의 안전장치
      graceTimer = setTimeout(() => finish(1), 3000)
    }
    timer = setTimeout(() => { timedOut = true; stop() }, o.timeoutMs)
    if (o.signal?.aborted) stop()
    else o.signal?.addEventListener('abort', stop, { once: true })
  })
}
