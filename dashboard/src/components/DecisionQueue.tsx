import { useEffect, useRef, useState } from 'react'
import { waited, type Decision } from '../model/decisions'

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * 관제 화면 맨 위의 결정 큐: 사람이 할 일만, 오래 기다린 순서로.
 * j/k로 고르고 Enter로 처리 카드를 연다(입력 중이 아닐 때).
 */
export function DecisionQueue({ decisions, onOpen }: { decisions: Decision[]; onOpen: (d: Decision) => void }) {
  const [cur, setCur] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  useEffect(() => { if (cur >= decisions.length) setCur(Math.max(0, decisions.length - 1)) }, [cur, decisions.length])

  const openRef = useRef(onOpen)
  openRef.current = onOpen
  useEffect(() => {
    if (decisions.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return
      if (e.key !== 'j' && e.key !== 'k') return
      e.preventDefault()
      setCur((c) => {
        const n = Math.min(decisions.length - 1, Math.max(0, c + (e.key === 'j' ? 1 : -1)))
        rows.current[n]?.focus()
        return n
      })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [decisions.length])

  if (decisions.length === 0) {
    return <section className="dq is-empty" aria-label="결정 큐"><span className="dq-dot" aria-hidden="true" />결정할 일이 없습니다. 에이전트가 진행 중입니다.</section>
  }
  return (
    <section className="dq" aria-labelledby="dq-title">
      <header className="dq-head">
        <h2 id="dq-title">결정 큐 <span className="mono">{decisions.length}</span></h2>
        <span className="dq-keys" aria-hidden="true"><kbd>j</kbd>/<kbd>k</kbd> 이동 · <kbd>Enter</kbd> 처리</span>
      </header>
      <ol className="dq-list">
        {decisions.map((d, i) => (
          <li key={d.key}>
            <button type="button" ref={(el) => { rows.current[i] = el }} className={`dq-row${d.item.kind === 'start' ? ' is-start' : ''}`} aria-current={i === cur ? 'true' : undefined}
              tabIndex={i === cur ? 0 : -1} onFocus={() => setCur(i)} onClick={() => onOpen(d)}>
              <span className="dq-title"><strong>{d.title}</strong>{d.task && <span className="mono"> · {d.task}</span>}</span>
              <span className="dq-why">{d.why}</span>
              <span className="dq-choose"><b>할 일</b> {d.choose} <span className="dq-outcome">→ {d.outcome}</span></span>
              <span className="dq-wait mono">{waited(d.since, now)}</span>
              <span className="dq-go" aria-hidden="true">{d.item.kind === 'start' ? `${d.title} ›` : '처리 ›'}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
