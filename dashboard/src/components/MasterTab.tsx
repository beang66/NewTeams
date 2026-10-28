import { useState } from 'react'
import type { Envelope } from '@orch/protocol/messages'
import type { Stage } from '@orch/store/state'
import { api } from '../api/client'

const textOf = (e: Envelope): string => {
  const t = (e.payload as { text?: unknown } | null)?.text
  return typeof t === 'string' ? t : ''
}

export function MasterTab({ events, stage }: { events: Envelope[]; stage: Stage }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const chats = events.filter((e) => e.type === 'CHAT')

  const send = async () => {
    const text = message.trim()
    if (!text || busy) return
    setBusy(true); setError(undefined)
    try { await api.chat(text); setMessage('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="master-tab">
      {chats.length === 0 ? <p className="panel-empty">아직 대화가 없습니다</p> : (
        <ol className="chat-list" aria-label="마스터 대화">
          {chats.map((e) => (
            <li key={e.id} className={e.from === 'user' ? 'is-user' : 'is-master'}>
              <span className="chat-bubble">{textOf(e)}</span>
            </li>
          ))}
        </ol>
      )}
      {stage === 'INTAKE' ? (
        <form className="chat-form" onSubmit={(ev) => { ev.preventDefault(); void send() }}>
          <label className="field">
            <span className="field-label">마스터에게 보낼 메시지</span>
            <textarea rows={3} value={message} disabled={busy} onChange={(e) => setMessage(e.target.value)} />
          </label>
          {error && <p className="acard-error" role="alert">{error}</p>}
          <button type="submit" className="btn is-primary" disabled={busy || !message.trim()}>{busy ? '보내는 중…' : '보내기'}</button>
        </form>
      ) : (
        <p className="panel-empty">요구사항 대화는 끝났습니다. 아래 '마스터에게 묻기'를 쓰세요.</p>
      )}
    </div>
  )
}
