import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Envelope, Usage } from '../protocol/messages.js'
import { addUsage, emptyTotal, usageSources, type UsageTotal } from './usage.js'

/** 대시보드 전체 사용량: 모든 프로젝트의 파이프라인 이벤트 + 스킬·루틴 실행 기록. */
export function dashboardUsage(projectsDir: string): { total: UsageTotal; projects: { name: string; tokens: number; costUsd: number; hasCost: boolean }[]; skills: UsageTotal } {
  const total = emptyTotal()
  const skills = emptyTotal()
  const projects: { name: string; tokens: number; costUsd: number; hasCost: boolean }[] = []
  const names = existsSync(projectsDir) ? readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []
  for (const name of names) {
    const t = emptyTotal()
    for (const line of readLines(join(projectsDir, name, 'raw', 'events.jsonl'))) {
      for (const s of usageSources(line as Envelope)) addUsage(t, s.usage)
    }
    // 스킬 기록은 상태가 바뀔 때마다 한 줄씩 쌓이므로 실행 id마다 마지막 줄만 센다.
    const runs = new Map<string, { usage?: Usage }>()
    for (const line of readLines(join(projectsDir, name, 'skill-runs', 'history.jsonl'))) {
      const r = line as { id?: string; usage?: Usage }
      if (r.id) runs.set(r.id, r)
    }
    for (const r of runs.values()) if (r.usage) { addUsage(t, r.usage); addUsage(skills, r.usage) }
    projects.push({ name, ...t })
    total.tokens += t.tokens; total.costUsd += t.costUsd; total.hasCost ||= t.hasCost
  }
  return { total, projects, skills }
}

function readLines(path: string): unknown[] {
  if (!existsSync(path)) return []
  const out: unknown[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 깨진 줄 */ }
  }
  return out
}
