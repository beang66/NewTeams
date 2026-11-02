import type { RunResult } from './types.js'
import { RunnerError } from './types.js'

function parseJsonLines(lines: string[]): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  for (const l of lines) {
    const s = l.trim()
    if (!s.startsWith('{')) continue
    try {
      const o = JSON.parse(s)
      if (o && typeof o === 'object') out.push(o)
    } catch { /* 경고 등 JSON이 아닌 줄은 건너뛴다 */ }
  }
  return out
}
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function parseClaudeStream(lines: string[]): RunResult {
  const objs = parseJsonLines(lines)
  let result: Record<string, any> | undefined
  for (let i = objs.length - 1; i >= 0; i--) if (objs[i]!.type === 'result') { result = objs[i]; break }
  if (!result) throw new RunnerError('format', 'claude stream has no result line')
  const text = typeof result.result === 'string' ? result.result : ''
  if (result.is_error === true) throw classifyClaudeFailure(lines, '', 1)
  const u = result.usage ?? {}
  const cached = n(u.cache_read_input_tokens)
  const denied = (Array.isArray(result.permission_denials) ? result.permission_denials : [])
    .map((d: { tool_name?: unknown; tool_input?: { file_path?: unknown; command?: unknown } }) =>
      `${String(d.tool_name ?? '?')}${typeof d.tool_input?.file_path === 'string' ? `: ${d.tool_input.file_path}` : typeof d.tool_input?.command === 'string' ? `: ${d.tool_input.command}` : ''}`)
  return {
    text,
    ...(denied.length ? { denied } : {}),
    sessionId: typeof result.session_id === 'string' ? result.session_id : undefined,
    usage: {
      in: n(u.input_tokens) + n(u.cache_creation_input_tokens) + cached,
      cached,
      out: n(u.output_tokens),
      ...(typeof result.total_cost_usd === 'number' ? { costUsd: result.total_cost_usd } : {}),
    },
  }
}

/** Prefer the CLI's Unix reset timestamp over localized human-readable error text. */
export function classifyClaudeFailure(lines: string[], stderr: string, exitCode: number): RunnerError {
  const events = parseJsonLines(lines).reverse()
  const result = events.find((event) => event.type === 'result' && event.is_error === true)
  const message = typeof result?.result === 'string' ? result.result : `${lines.join('\n')}\n${stderr}`
  const limited = events.find((event) => event.type === 'rate_limit_event' && event.rate_limit_info?.status === 'rejected')
  if (!limited) return classifyFailure(message, exitCode)

  const info = limited.rate_limit_info
  const windows = Object.values(info.unifiedWindows ?? {}) as Array<{ status?: string; resetsAt?: number }>
  const blockedWindows = windows.filter((window) => window?.status === 'rejected')
  const resets = [info.resetsAt, ...blockedWindows.map((window) => window.resetsAt)]
    .filter(validResetSeconds)
  if (!resets.length) return classifyFailure(`rate limit: ${message}`, exitCode)
  return new RunnerError('rate_limit', message.trim().slice(0, 500), new Date(Math.max(...resets) * 1000))
}

function validResetSeconds(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && Number.isFinite(new Date(value * 1000).getTime())
}

export function parseCodexStream(lines: string[]): RunResult {
  const objs = parseJsonLines(lines)
  let text: string | undefined
  let sessionId: string | undefined
  const usage = { in: 0, out: 0, cached: 0 }
  for (const o of objs) {
    if (o.type === 'thread.started' && typeof o.thread_id === 'string') sessionId = o.thread_id
    else if (o.type === 'item.completed' && o.item?.type === 'agent_message' && typeof o.item.text === 'string') text = o.item.text
    else if (o.type === 'turn.completed') {
      const u = o.usage ?? {}
      usage.in += n(u.input_tokens)
      usage.cached += n(u.cached_input_tokens)
      usage.out += n(u.output_tokens) + n(u.reasoning_output_tokens)
    }
  }
  if (text === undefined) throw new RunnerError('format', 'codex stream has no agent_message')
  return { text, sessionId, usage }
}

const LIMIT_RE = /usage limit|session limit|rate limit|limit will reset|429/i
const AUTH_RE = /login|unauthori[sz]ed|invalid api key|401/i

function parseResetAt(output: string, now: Date): Date {
  const iso = /reset\w*\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(output)
  if (iso) {
    const d = new Date(iso[1]!)
    if (!Number.isNaN(d.getTime())) return d
  }
  const t = /reset\w*\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(output)
  if (t) {
    let h = Number(t[1]); const m = t[2] ? Number(t[2]) : 0; const ap = t[3]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h <= 23 && m <= 59) {
      const d = new Date(now); d.setHours(h, m, 0, 0)
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return d
    }
  }
  return new Date(now.getTime() + 3_600_000)
}

export function classifyFailure(output: string, exitCode: number, now: Date = new Date()): RunnerError {
  const limit = LIMIT_RE.test(output)
  if (limit) return new RunnerError('rate_limit', output.trim().slice(0, 500), parseResetAt(output, now))
  if (AUTH_RE.test(output)) return new RunnerError('auth', output.trim().slice(0, 500))
  return new RunnerError('crash', `exit ${exitCode}: ${output.trim().slice(0, 500)}`)
}
