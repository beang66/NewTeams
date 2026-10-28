import type { Workflow } from '../engine/workflow.js'

/** 사람 입력 시점이 맞지 않음(이미 처리됨, INTAKE 아님 등) → HTTP 409 */
export class ActionConflict extends Error {}

export interface TelegramStatus {
  state: 'off' | 'connecting' | 'connected' | 'error'
  botUsername?: string
  lastError?: string
  lastOkAt?: string
}

export interface WorkflowActions {
  chat(message: string): Promise<{ reply: string; specDraft?: string }>
  approveSpec(): Promise<void>
  answer(eventId: string, a: { action: 'guidance' | 'skip'; text: string; restartSession?: boolean }): Promise<void>
  resume(): Promise<void>
  ask(question: string): Promise<string>
  /** 워크플로 실행(이미 돌고 있으면 무시) */
  drive(): void
}

const CONFLICT = /INTAKE|스펙 초안|열린 HUMAN_REQUIRED/

/** Runs at most one workflow, including while it is paused inside a runner. */
export function createWorkflowDriver(wf: Workflow, onError: (error: unknown) => void | Promise<void>): () => void {
  let running: Promise<unknown> | undefined
  return () => {
    if (running) return
    running = Promise.resolve().then(() => wf.runUntilBlocked()).catch(onError).catch((error: unknown) => console.error('Workflow error notification failed', error)).finally(() => { running = undefined })
  }
}

export function createWorkflowActions(wf: Workflow, onDriveError: (e: unknown) => void | Promise<void>): WorkflowActions {
  const drive = createWorkflowDriver(wf, onDriveError)
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => {
      try { return await action() } catch (error) {
        // State conflicts are expected client errors. Runner/storage failures propagate unchanged.
        if (error instanceof Error && CONFLICT.test(error.message)) throw new ActionConflict(error.message, { cause: error })
        throw error
      }
    })
    queue = result.catch(() => undefined)
    return result
  }
  return {
    chat: (message) => serialized(() => wf.chat(message)),
    approveSpec: () => serialized(async () => { await wf.approveSpec(); drive() }),
    answer: (eventId, a) => serialized(async () => { await wf.answerHuman(eventId, a); drive() }),
    // 직렬화하지 않는다: 게이트 대기 중인 chat/answer가 큐를 잡고 있어도 사람 재개는 통과해야 한다.
    resume: async () => { await wf.gate.resumeByHuman(); drive() },
    ask: (question) => wf.askLog(question),
    drive,
  }
}
