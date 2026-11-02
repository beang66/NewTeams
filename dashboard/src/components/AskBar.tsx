import { useState } from 'react'
import type { Envelope } from '@orch/protocol/messages'
import { api } from '../api/client'
import { typeLabel } from '../model/labels'
import { clock } from '../model/doneStats'
import { Markdown } from './Markdown'

export function RecentLine({ events }: { events: Envelope[] }) {
  const last = events[events.length - 1]
  if (!last) return null
  return <span className="ticker">{`${last.id} · ${last.from} → ${last.to} · ${typeLabel[last.type]} · ${clock(last.ts)}`}</span>
}

export function AskBar({ events, onRawLink }: { events: Envelope[]; onRawLink?: (eventId: string) => void }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true); setError(undefined)
    try { setAnswer(await api.ask(q)); setQuestion('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="askbar">
      {(answer !== undefined || error) && (
        <section className="ask-answer" aria-label="마스터 답변">
          {error ? <p className="acard-error" role="alert">{error}</p> : <Markdown source={answer ?? ''} onRawLink={onRawLink} />}
          <button type="button" className="btn" onClick={() => { setAnswer(undefined); setError(undefined) }}>닫기</button>
        </section>
      )}
      <div className="ask-row">
        <form className="ask-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <input type="text" name="question" autoComplete="off" className="ask-input" aria-label="마스터에게 묻기" placeholder="마스터에게 묻기 — 예: “t3이 왜 세 번 걸렸는지 요약해 줘”…"
            value={question} disabled={busy} onChange={(e) => setQuestion(e.target.value)} />
          <button type="submit" className="btn is-primary" disabled={busy || !question.trim()}>{busy ? '묻는 중…' : '묻기'}</button>
          <span className="ask-note">사용량을 씁니다</span>
        </form>
        <RecentLine events={events} />
      </div>
    </div>
  )
}
