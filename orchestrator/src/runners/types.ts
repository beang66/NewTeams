import type { AgentProvider, Role } from '../config.js'
import type { Usage } from '../protocol/messages.js'

export interface RunRequest {
  provider?: AgentProvider
  role: Role; prompt: string; model: string; cwd: string
  resumeSessionId?: string; fork?: boolean; images?: string[]; outputSchema?: object
  /** resumeSessionId로 이어가는 요청을 세션 없이 처음부터 보낼 때 쓸 전체 프롬프트 */
  freshPrompt?: string
  /** 사용자가 직접 시킨 실행(스킬)만 true: 사용자 전역 설정(스킬·플러그인·MCP)을 싣는다 */
  userSettings?: boolean
  /** claude --effort 값 */
  effort?: string
  /** 사람이 승인한 실행만: 파일 편집을 묻지 않고 허용(--permission-mode acceptEdits) */
  acceptEdits?: boolean
  /** 사람이 중단하면 프로세스를 끝낸다 */
  signal?: AbortSignal
  timeoutMs: number; allowedTools?: string[]; addDirs?: string[]; mcpConfig?: string; rawLogPath: string
}
/** denied: 권한 확인이 없어 거부된 도구 호출("Write: report.md") */
export interface RunResult { text: string; sessionId?: string; usage: Usage; denied?: string[] }
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
