import { useEffect, useRef, useState } from 'react'
import type { Plan } from '@orch/protocol/plan'
import type { RunState } from '@orch/store/state'
import { ApiError, api } from '../api/client'
import type { AttentionItem } from '../model/attention'
import { pendingDependents } from '../model/dependents'
import { reasonLabel } from '../model/labels'

export interface CardCtx {
  plan?: Plan | null
  state?: RunState
  onEvidence?: (taskId: string) => void
  onOpenSpec?: () => void
  /** Called after a successful [재개] so the tab can watch for a repeat of the same reason. */
  onResumed?: (reason: string) => void
  retryMessage?: string
}

type Busy = 'guidance' | 'skip' | 'resume' | undefined

const RETRY_REASONS: Record<string, string> = { auth: '아직 로그인되지 않았습니다', openai_cap: '아직 상한이 그대로입니다' }
export const retryMessageFor = (item: AttentionItem): string | undefined =>
  item.kind === 'login' ? RETRY_REASONS.auth : item.kind === 'human' ? RETRY_REASONS[item.reason] : undefined

export function AttentionCard({ item, ctx }: { item: AttentionItem; ctx: CardCtx }) {
  const [text, setText] = useState('')
  const [restart, setRestart] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [busy, setBusy] = useState<Busy>()
  const [error, setError] = useState<string | undefined>()
  const [handled, setHandled] = useState(false)

  const inflight = useRef(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const skipRef = useRef<HTMLButtonElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const firstConfirm = useRef(true)
  useEffect(() => {
    if (firstConfirm.current) { firstConfirm.current = false; return }
    if (confirmSkip) confirmRef.current?.focus(); else skipRef.current?.focus()
  }, [confirmSkip])
  useEffect(() => { if (handled) doneRef.current?.focus() }, [handled])

  const run = async (kind: Exclude<Busy, undefined>, fn: () => Promise<void>) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(kind); setError(undefined)
    try {
      await fn()
      if (kind === 'resume') ctx.onResumed?.(item.kind === 'login' ? 'auth' : item.kind === 'human' ? item.reason : '')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setHandled(true)
      else setError(e instanceof Error ? e.message : String(e))
    } finally { inflight.current = false; setBusy(undefined) }
  }

  if (item.kind === 'spec') {
    return (
      <article className="acard">
        <h3 className="acard-title">스펙 초안이 준비됐습니다</h3>
        <div className="acard-actions"><button type="button" className="btn is-primary" onClick={ctx.onOpenSpec}>스펙 보기</button></div>
      </article>
    )
  }

  const retry = ctx.retryMessage
  const resumeBtn = (label: string) => (
    <button type="button" className="btn is-primary" disabled={busy !== undefined} onClick={() => void run('resume', () => api.resume())}>
      {busy === 'resume' ? '보내는 중…' : label}
    </button>
  )
  const status = (
    <>
      {retry && <p className="acard-note" role="status">{retry}</p>}
      {error && <p className="acard-error" role="alert">{error}</p>}
    </>
  )

  if (item.kind === 'login') {
    return (
      <article className={`acard${handled ? ' is-handled' : ''}`}>
        <h3 className="acard-title">터미널에서 다시 로그인 필요</h3>
        <p className="acard-text">Claude: 터미널에서 <code>claude</code> 실행 후 <code>/login</code> · Codex: <code>codex login</code></p>
        {status}
        {handled ? <p className="acard-done" ref={doneRef} tabIndex={-1}>이미 처리됨</p> : <div className="acard-actions">{resumeBtn('로그인했어요, 재개')}</div>}
      </article>
    )
  }

  const task = item.task
  const canSkip = !!task && task !== 'plan'
  const dependents = task ? pendingDependents(task, ctx.plan, ctx.state) : 0
  const confirmText = `정말 건너뛸까요?${dependents > 0 ? ` 이 태스크에 의존하는 ${dependents}개 태스크도 함께 건너뜁니다` : ''}`
  const disabled = busy !== undefined

  return (
    <article className={`acard${handled ? ' is-handled' : ''}`}>
      <header className="acard-head">
        <h3 className="acard-title">{task ? <span className="mono">{task}</span> : null}{task ? ' · ' : ''}{reasonLabel(item.reason) || item.reason}</h3>
        {task && ctx.onEvidence && <button type="button" className="link-btn" onClick={() => ctx.onEvidence!(task)}>근거 보기</button>}
      </header>
      {item.detail && <p className="acard-text">{item.detail}</p>}
      {item.findings.length > 0 && (
        <ul className="findings" aria-label="반복된 지적">
          {item.findings.map((f) => (
            <li key={f.id} className="finding">
              <span className="mono finding-id">{f.id}</span>
              <span className={`chip finding-sev${f.severity === 'minor' ? '' : ' is-bad'}`}>{f.severity}</span>
              <span className="finding-issue" title={f.issue}>{f.issue}</span>
            </li>
          ))}
        </ul>
      )}
      {item.tried.length > 0 && (
        <div className="acard-tried">
          <h4>마스터가 시도한 지침</h4>
          <ul>{item.tried.map((t, i) => <li key={i} className="finding-issue">{t}</li>)}</ul>
        </div>
      )}
      {status}
      {handled ? <p className="acard-done" ref={doneRef} tabIndex={-1}>이미 처리됨</p> : (
        <>
          <label className="field">
            <span className="field-label">지침</span>
            <textarea rows={3} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={restart} disabled={disabled} onChange={(e) => setRestart(e.target.checked)} />
            <span>새 세션으로 다시 시작</span>
          </label>
          <div className="acard-actions">
            <button type="button" className="btn is-primary" disabled={disabled}
              onClick={() => void run('guidance', () => api.answer(item.eventId, { action: 'guidance', text, restartSession: restart }))}>
              {busy === 'guidance' ? '보내는 중…' : '지침 보내기'}
            </button>
            {item.reason === 'openai_cap' && resumeBtn('재개')}
            {canSkip && !confirmSkip && (
              <button type="button" className="btn" ref={skipRef} disabled={disabled} onClick={() => setConfirmSkip(true)}>이 태스크 건너뛰기</button>
            )}
            {canSkip && confirmSkip && (
              <>
                <button type="button" className="btn is-danger" ref={confirmRef} disabled={disabled}
                  onClick={() => void run('skip', async () => { await api.answer(item.eventId, { action: 'skip', text, restartSession: restart }); setConfirmSkip(false) })}>
                  {busy === 'skip' ? '보내는 중…' : confirmText}
                </button>
                <button type="button" className="btn" disabled={disabled} onClick={() => setConfirmSkip(false)}>취소</button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  )
}
