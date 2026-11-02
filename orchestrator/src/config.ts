import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

export interface TelegramConfig {
  apiBase: string
  quietHours: { start: string; end: string } | null
  heartbeatMinutes: number
  batchSeconds: number
  notifyTaskApprovals: boolean
  dashboardUrl: string | null
  pollTimeoutSec: number
}
const httpUrl = z.url().refine(v => { try { const p = new URL(v).protocol; return p === 'http:' || p === 'https:' } catch { return false } }, 'http 또는 https URL만 허용')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/).refine(v => { const [h, m] = v.split(':').map(Number); return h! <= 23 && m! <= 59 }, 'HH:mm')
const telegramSchema = z.object({
  apiBase: httpUrl.optional(),
  quietHours: z.object({ start: hhmm, end: hhmm }).strict().refine(q => q.start !== q.end, 'start와 end가 같음').nullable().optional(),
  heartbeatMinutes: z.number().int().refine(n => n === 0 || (n >= 5 && n <= 1440), '0 또는 5~1440').optional(),
  batchSeconds: z.number().int().min(0).optional(),
  notifyTaskApprovals: z.boolean().optional(),
  dashboardUrl: httpUrl.nullable().optional(),
  pollTimeoutSec: z.number().int().min(1).optional(),
}).strict()

export interface VaultConfig {
  /** Obsidian Vault 절대 경로. null이면 연결하지 않는다. 환경 변수 ORCH_VAULT_DIR가 우선한다. */
  path: string | null
  /** path 폴더가 없을 때 대신 읽을 Git 저장소 URL(얕은 clone). null이면 대체 없음. */
  github: string | null
  /** 검색·참조를 허용하는 Vault 안 폴더 */
  read: string[]
  /** AI 결과를 새 파일로 저장하는 Vault 안 폴더 */
  inbox: string
  /** 파이프라인 설계·단계별 완수 기준 노트 폴더(Vault 안). 에이전트 프롬프트에 해당 단계 문서를 붙인다. */
  pipeline: string
  /** 전문가 그래프 폴더(Vault 안): 작업·지식·과정·도구·기준 노트. 에이전트가 자기 작업에서 경로를 따라 읽는다. */
  graph: string
}
const vaultSchema = z.object({
  path: z.string().min(1).nullable().optional(),
  github: httpUrl.nullable().optional(),
  read: z.array(z.string().min(1)).min(1).optional(),
  inbox: z.string().min(1).optional(),
  pipeline: z.string().min(1).optional(),
  graph: z.string().min(1).optional(),
}).strict()

export interface Config {
  vault: VaultConfig
  agents: AgentSettings
  telegram: TelegramConfig
  projectsDir: string; maxParallel: number; rejectLimit: number; repeatFindingLimit: number
  timeoutsMs: Record<Role, number>; cliRetry: number; formatRepairRetry: number
  mergeConflictRetry: number; openaiCapUsd: number; openaiModel: string
  openaiPricePerMTok: { in: number; out: number }
  claudeBin: string; codexBin: string; port: number
}

export const DEFAULT_CONFIG: Config = {
  vault: { path: join(homedir(), 'Documents', 'Obsidian Vault'), github: 'https://github.com/beang66/Vault', read: ['01 Projects', 'wiki'], inbox: '01 Projects/[진행] NEWTEAMs AI Agent Studio/AI Inbox', pipeline: '01 Projects/[진행] NEWTEAMs AI Agent Studio/파이프라인', graph: 'wiki/전문가 그래프' },
  agents: { master: { provider: 'claude' }, worker: { provider: 'claude' } },
  telegram: { apiBase: 'https://api.telegram.org', quietHours: null, heartbeatMinutes: 0, batchSeconds: 30, notifyTaskApprovals: false, dashboardUrl: null, pollTimeoutSec: 30 },
  projectsDir: './projects',
  maxParallel: 3,
  rejectLimit: 3,
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
  let tg
  try { tg = telegramSchema.parse(over.telegram ?? {}) } catch (error) { throw new Error(`telegram 설정 오류: ${String(error)}`) }
  let vault
  try { vault = vaultSchema.parse(over.vault ?? {}) } catch (error) { throw new Error(`vault 설정 오류: ${String(error)}`) }
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...over,
    agents: { master: { ...DEFAULT_CONFIG.agents.master, ...profiles.master }, worker: { ...DEFAULT_CONFIG.agents.worker, ...profiles.worker } },
    telegram: { ...DEFAULT_CONFIG.telegram, ...stripUndefined(tg) } as TelegramConfig,
    vault: { ...DEFAULT_CONFIG.vault, ...stripUndefined(vault) } as VaultConfig,
    timeoutsMs: { ...DEFAULT_CONFIG.timeoutsMs, ...over.timeoutsMs },
    openaiPricePerMTok: { ...DEFAULT_CONFIG.openaiPricePerMTok, ...over.openaiPricePerMTok },
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
