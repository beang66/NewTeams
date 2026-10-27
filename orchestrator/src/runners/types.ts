import type { AgentProvider, Role } from '../config.js'
import type { Usage } from '../protocol/messages.js'

export interface RunRequest {
  provider?: AgentProvider
  role: Role; prompt: string; model: string; cwd: string
  resumeSessionId?: string; fork?: boolean; images?: string[]; outputSchema?: object
  timeoutMs: number; allowedTools?: string[]; addDirs?: string[]; mcpConfig?: string; rawLogPath: string
}
export interface RunResult { text: string; sessionId?: string; usage: Usage }
export type RunnerErrorKind = 'rate_limit' | 'auth' | 'timeout' | 'crash' | 'format'
export class RunnerError extends Error {
  kind: RunnerErrorKind
  resetAt?: Date
  constructor(kind: RunnerErrorKind, message: string, resetAt?: Date) {
    super(message)
    this.name = 'RunnerError'
    this.kind = kind
    this.resetAt = resetAt
  }
}
export interface Runner { run(req: RunRequest): Promise<RunResult> }
