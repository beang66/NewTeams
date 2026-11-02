import { useEffect, useState, type KeyboardEvent } from 'react'
import type { RunView } from '../api/useRun'
import { api } from '../api/client'
import { hasDraft } from '../api/useSpecDraft'
import { RecentLine } from '../components/AskBar'
import { Markdown } from '../components/Markdown'
import { Skeleton } from '../components/Skeleton'
import { TopBar, useProjectName } from '../components/TopBar'
import { UsagePanel } from '../components/UsageGauges'
import { DecisionQueue } from '../components/DecisionQueue'
import { attentionItems } from '../model/attention'
import { decisionsOf } from '../model/decisions'
import { usageView } from '../model/usage'

const EMPTY = '만들고 싶은 것을 마스터에게 설명해 주세요. 대화가 끝나면 오른쪽에 스펙 초안이 채워집니다.'
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

interface Props {
  run: RunView
  draft: string | null
  /** Told whenever the draft text is (re)loaded so the shell can keep its attention count in sync. */
  onDraft?: (draft: string | null) => void
}

export function IntakeScreen({ run, draft: draftProp, onDraft }: Props) {
  const [draft, setDraft] = useState<string | null>(draftProp)
  useEffect(() => setDraft(draftProp), [draftProp])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [side, setSide] = useState<'spec' | 'usage'>('spec')
  const chats = run.events.filter((e) => e.type === 'CHAT')
  const project = useProjectName()
  const usage = usageView(run.events, run.state, run.agents, new Date())
  const decisions = decisionsOf(attentionItems(run.state, run.events, { hasSpecDraft: hasDraft(draft) }))

  const send = async () => {
    const text = message.trim()
    if (!text || sending) return
    setSending(true); setError(undefined)
    try {
      const res = await api.chat(text)
      setMessage('')
      if (res.specDraft) {
        const next = await api.human('spec.draft.md').catch(() => null)
        setDraft(next); onDraft?.(next)
      }
    } catch (e) { setError(errText(e)) } finally { setSending(false) }
  }
  const approve = async () => {
    if (approving) return
    setApproving(true); setError(undefined)
    try { await api.approveSpec() } catch (e) { setError(errText(e)) } finally { setApproving(false) }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void send()
  }

  return (
    <div className="control">
      <TopBar run={run} hasSpecDraft={hasDraft(draft)} />
      <DecisionQueue decisions={decisions} onOpen={() => document.getElementById('spec-approve')?.focus()} />
      <main className="intake-grid">
        <section className="intake-chat" aria-label="마스터 대화">
          {run.loading ? <Skeleton lines={4} /> : chats.length === 0 ? <p className="panel-empty">{EMPTY}</p> : (
            <ol className="chat-list">
              {chats.map((e) => {
                const t = (e.payload as { text?: unknown } | null)?.text
                return <li key={e.id} className={e.from === 'user' ? 'is-user' : 'is-master'}><span className="chat-bubble">{typeof t === 'string' ? t : ''}</span></li>
              })}
            </ol>
          )}
          <div className="grow" />
          {error && <p className="acard-error" role="alert">{error}</p>}
          <label className="field-label" htmlFor="master-input">마스터에게 보내기 (Enter 전송 · Shift+Enter 줄바꿈)</label>
          {/* 보내기 버튼은 입력칸 안 오른쪽 아래에 둔다(메신저처럼 쓰고 바로 보낸다). */}
          <div className="chat-compose" aria-busy={sending}>
            <textarea id="master-input" rows={3} aria-label="마스터에게 보내기" value={message} readOnly={sending}
              onChange={(e) => setMessage(e.target.value)} onKeyDown={onKey} placeholder="만들고 싶은 것을 설명하세요…" />
            <button type="button" className="btn is-primary chat-send" disabled={!message.trim() || sending} onClick={() => void send()}>
              {sending ? '보내는 중…' : '보내기 ↵'}
            </button>
          </div>
        </section>
        <aside className="intake-spec" aria-label="스펙 초안과 토큰 사용량">
          {/* 같은 자리에서 스펙 초안과 토큰 사용량을 바꿔 본다. 승인 단계는 탭과 상관없이 아래에 남는다. */}
          <div className="intake-tabs" role="tablist" aria-label="오른쪽 보기">
            <button type="button" role="tab" id="itab-spec" aria-selected={side === 'spec'} aria-controls="ipanel" onClick={() => setSide('spec')}>스펙 초안</button>
            <button type="button" role="tab" id="itab-usage" aria-selected={side === 'usage'} aria-controls="ipanel" onClick={() => setSide('usage')}>토큰 사용량</button>
          </div>
          <div className="intake-spec-body" role="tabpanel" id="ipanel" aria-labelledby={side === 'spec' ? 'itab-spec' : 'itab-usage'}>
            {side === 'spec'
              ? <><p className="intake-spec-file mono">spec.draft.md</p>{hasDraft(draft) ? <Markdown source={draft!} /> : <p className="panel-empty">아직 초안이 없습니다</p>}</>
              : <UsagePanel usage={usage} project={project} />}
          </div>
          <ol className="intake-steps" aria-label="실행까지 두 단계">
            <li className="is-current">
              <span className="intake-step-text"><strong>1. 스펙 승인</strong><small>초안을 읽고 범위와 수용 기준을 확정합니다</small></span>
              <button type="button" id="spec-approve" className="btn is-primary" disabled={!hasDraft(draft) || approving} onClick={() => void approve()}>스펙 승인</button>
            </li>
            <li>
              <span className="intake-step-text"><strong>2. 파이프라인 시작</strong><small>승인하면 관제 화면 결정 큐 맨 위에서 시작합니다. 시작부터 실제 Claude·GPT 비용이 듭니다</small></span>
              <button type="button" className="btn" disabled>시작</button>
            </li>
          </ol>
        </aside>
      </main>
      <div className="askbar"><div className="ask-row"><RecentLine events={run.events} /></div></div>
    </div>
  )
}
