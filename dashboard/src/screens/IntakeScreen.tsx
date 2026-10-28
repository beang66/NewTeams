import { useEffect, useState, type KeyboardEvent } from 'react'
import type { RunView } from '../api/useRun'
import { api } from '../api/client'
import { hasDraft } from '../api/useSpecDraft'
import { RecentLine } from '../components/AskBar'
import { Markdown } from '../components/Markdown'
import { Skeleton } from '../components/Skeleton'
import { TopBar } from '../components/TopBar'

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
  const chats = run.events.filter((e) => e.type === 'CHAT')

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
          <label className="field">
            <span className="field-label">마스터에게 보내기 (Enter 전송 · Shift+Enter 줄바꿈)</span>
            <textarea rows={3} aria-label="마스터에게 보내기" value={message} readOnly={sending} aria-busy={sending}
              onChange={(e) => setMessage(e.target.value)} onKeyDown={onKey} />
          </label>
        </section>
        <aside className="intake-spec" aria-label="스펙 초안">
          <h2 className="intake-spec-head">스펙 초안 · spec.draft.md</h2>
          <div className="intake-spec-body">
            {hasDraft(draft) ? <Markdown source={draft!} /> : <p className="panel-empty">아직 초안이 없습니다</p>}
          </div>
          <div className="intake-actions">
            <button type="button" className="btn is-primary" disabled={!hasDraft(draft) || approving} onClick={() => void approve()}>스펙 승인</button>
          </div>
        </aside>
      </main>
      <div className="askbar"><div className="ask-row"><RecentLine events={run.events} /></div></div>
    </div>
  )
}
