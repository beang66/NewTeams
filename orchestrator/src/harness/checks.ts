import { spawn, spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { assertChildStartAllowed, trackOwnedChild } from '../runners/ownedChildren.js'

export interface CheckResult { ok: boolean; results: { cmd: string; exitCode: number; output: string }[] }

const OUTPUT_LIMIT = 4000

function runOne(cwd: string, cmd: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
  assertChildStartAllowed()
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' })
    trackOwnedChild(child)
    const finish = (exitCode: number, suffix = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, output: (out + suffix).slice(-OUTPUT_LIMIT) })
    }
    const timer = setTimeout(() => {
      if (child.pid) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
      }
      finish(-1, '\n(시간 초과)')
    }, timeoutMs)
    const add = (d: Buffer) => { out += d.toString(); if (out.length > OUTPUT_LIMIT * 4) out = out.slice(-OUTPUT_LIMIT * 2) }
    child.stdout?.on('data', add)
    child.stderr?.on('data', add)
    child.on('error', (e) => { out += String(e); finish(-1) })
    child.on('close', (code) => finish(code ?? -1))
  })
}

export async function runChecks(cwd: string, commands: string[], timeoutMs: number): Promise<CheckResult> {
  const results: CheckResult['results'] = []
  for (const cmd of commands) results.push({ cmd, ...(await runOne(cwd, cmd, timeoutMs)) })
  return { ok: results.every((r) => r.exitCode === 0), results }
}

const norm = (p: string) => p.replaceAll('\\', '/')

/** 소유 범위(glob 허용) 밖에서 바뀐 파일 목록. */
export function checkOwnership(changed: string[], owned: string[]): string[] {
  const isOwned = picomatch(owned.map(norm), { dot: true })
  return changed.filter((f) => !isOwned(norm(f)))
}

/** 에이전트 CLI가 다음 실행 때 읽는 설정(훅·권한·MCP). 에이전트가 고치면 스스로 권한을 넓힐 수 있다. */
const AGENT_CONFIG = picomatch(['.claude/**', '**/.claude/**', '.codex/**', '**/.codex/**', '.mcp.json', '**/.mcp.json'], { dot: true })

/** 소유 범위와 무관하게 막는 에이전트 설정 파일 변경. */
export function checkAgentConfig(changed: string[]): string[] {
  return changed.filter((f) => AGENT_CONFIG(norm(f)))
}

export type EvidenceManifest = { scenarioId: string; steps: { step: number; action: string; screenshot: string; ts: string }[] }[]

export async function verifyEvidence(evidenceDir: string, lastChangeAt: Date): Promise<{ ok: boolean; problems: string[] }> {
  let manifest: EvidenceManifest
  try {
    manifest = JSON.parse(await fs.readFile(join(evidenceDir, 'manifest.json'), 'utf8'))
    if (!Array.isArray(manifest) || manifest.some((s) => !s || !Array.isArray(s.steps))) throw new Error('형식 오류')
  } catch (e) {
    return { ok: false, problems: [`manifest.json을 읽을 수 없음: ${(e as Error).message}`] }
  }
  const problems: string[] = []
  for (const scenario of manifest) {
    for (const step of scenario.steps) {
      const path = join(evidenceDir, step.screenshot)
      let mtimeMs: number
      try {
        mtimeMs = (await fs.stat(path)).mtimeMs
      } catch {
        problems.push(`${step.screenshot} 없음`)
        continue
      }
      const tsMs = Date.parse(step.ts)
      const capturedMs = Math.max(Number.isNaN(tsMs) ? 0 : tsMs, mtimeMs)
      if (capturedMs < lastChangeAt.getTime()) problems.push(`${step.screenshot}: 코드 변경 이전 캡처`)
    }
  }
  return { ok: problems.length === 0, problems }
}
