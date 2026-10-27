import { readFileSync } from 'node:fs'
import { z } from 'zod'

export type Role = 'master' | 'planner' | 'dev' | 'qa' | 'reviewer' | 'wiki' | 'logQuery'

export type AgentProvider = 'claude' | 'codex'
export interface AgentProfile { provider: AgentProvider; model?: string; escalatedModel?: string }
export interface AgentSettings { master: AgentProfile; worker: AgentProfile }
const profileSchema = z.object({
  provider: z.enum(['claude', 'codex']).optional(),
  model: z.string().min(1).regex(/^\S+$/).optional(),
  escalatedModel: z.string().min(1).regex(/^\S+$/).optional(),
}).strict()
const settingsSchema = z.object({ master: profileSchema.optional(), worker: profileSchema.optional() }).strict()

export interface Config {
  agents: AgentSettings
  projectsDir: string; maxParallel: number; rejectLimit: number; repeatFindingLimit: number
  timeoutsMs: Record<Role, number>; cliRetry: number; formatRepairRetry: number
  mergeConflictRetry: number; openaiCapUsd: number; openaiModel: string
  openaiPricePerMTok: { in: number; out: number }
  claudeBin: string; codexBin: string; port: number
}

export const DEFAULT_CONFIG: Config = {
  agents: { master: { provider: 'claude' }, worker: { provider: 'claude' } },
  projectsDir: './projects',
  maxParallel: 3,
  rejectLimit: 5,
  repeatFindingLimit: 2,
  timeoutsMs: {
    dev: 1_200_000, qa: 600_000, reviewer: 300_000, planner: 600_000,
    wiki: 180_000, master: 600_000, logQuery: 120_000,
  },
  cliRetry: 1,
  formatRepairRetry: 1,
  mergeConflictRetry: 2,
  openaiCapUsd: 8,
  openaiModel: 'gpt-5-mini',
  openaiPricePerMTok: { in: 0.25, out: 2.0 },
  claudeBin: 'claude',
  codexBin: 'codex',
  port: 4317,
}

export function loadConfig(path?: string): Config {
  if (path === undefined) return structuredClone(DEFAULT_CONFIG)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    throw new Error(`설정 파일을 읽을 수 없음: ${path} (${(e as Error).message})`)
  }
  let over: Partial<Config>
  try {
    over = JSON.parse(raw) as Partial<Config>
  } catch (e) {
    throw new Error(`설정 파일 JSON 파싱 실패: ${path} (${(e as Error).message})`)
  }
  return resolveConfig(over)
}

export function resolveConfig(over: Partial<Config>): Config {
  let profiles
  try { profiles = settingsSchema.parse(over.agents ?? {}) } catch (error) { throw new Error(`agents 설정 오류: ${String(error)}`) }
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...over,
    agents: { master: { ...DEFAULT_CONFIG.agents.master, ...profiles.master }, worker: { ...DEFAULT_CONFIG.agents.worker, ...profiles.worker } },
    timeoutsMs: { ...DEFAULT_CONFIG.timeoutsMs, ...over.timeoutsMs },
    openaiPricePerMTok: { ...DEFAULT_CONFIG.openaiPricePerMTok, ...over.openaiPricePerMTok },
  }
}
