import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Envelope } from '@orch/protocol/messages'
import { api, type AgentConfig, type TelegramStatus, type VaultSummary } from '../api/client'
import { reasonLabel, typeLabel } from '../model/labels'
import type { MyTurn } from '../model/homeMock'

/* 상단 바 도구: 날짜·시간, 메시지(마스터에게 묻기), 알림, 설정. */

/** 분이 바뀌는 순간에 맞춰 갱신하는 시계. 컴퓨터 시계와 같은 시각을 보여 준다. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const d = new Date()
      setNow(d)
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50)
    }
    tick()
    const onVisible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return now
}

export function Clock() {
  const now = useMinuteClock()
  const date = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
  const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <time className="ht-clock mono" dateTime={now.toISOString()} title="이 컴퓨터의 시각">
      <i aria-hidden="true">●</i> {date} {time}
    </time>
  )
}

/** 버튼 + 떠 있는 패널. 바깥을 누르거나 Esc를 누르면 닫힌다. */
function Popover({ label, icon, badge, children, wide }: { label: string; icon: ReactNode; badge?: number; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="ht-pop" ref={ref}>
      <button ref={btn} type="button" className="ht-ico" aria-label={badge ? `${label} ${badge}건` : label} title={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        {icon}{badge ? <b className="ht-badge">{badge}</b> : null}
      </button>
      {open && <div className={`ht-panel${wide ? ' is-wide' : ''}`} role="dialog" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

const IconChat = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
const IconBell = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
const IconGear = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M10.3 2.5h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9-2.6-.5v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z" /><circle cx="12" cy="12" r="3" /></svg>

/* ---------- 메시지: 마스터에게 묻기 ---------- */

interface Chat { q: string; a?: string; err?: string }

export function MessagePanel() {
  return (
    <Popover label="메시지 · 마스터에게 묻기" icon={<IconChat />} wide>
      {() => <Ask />}
    </Popover>
  )
}

function Ask() {
  const [log, setLog] = useState<Chat[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = q.trim()
    if (!text || busy) return
    setQ(''); setBusy(true)
    setLog((l) => [...l, { q: text }])
    try {
      const a = await api.ask(text)
      setLog((l) => l.map((c, i) => (i === l.length - 1 ? { ...c, a } : c)))
    } catch (error) {
      setLog((l) => l.map((c, i) => (i === l.length - 1 ? { ...c, err: error instanceof Error ? error.message : String(error) } : c)))
    } finally { setBusy(false) }
  }
  return (
    <div className="ht-ask">
      <header><strong>마스터에게 묻기</strong><small>실행 기록을 근거로 답합니다</small></header>
      <ol className="ht-chat" aria-live="polite">
        {log.length === 0 && <li className="ht-empty">예: "지금 막힌 태스크가 뭐야?", "어제 반려된 이유 알려줘"</li>}
        {log.map((c, i) => (
          <li key={i}>
            <p className="ht-q">{c.q}</p>
            {c.a ? <p className="ht-a">{c.a}</p> : c.err ? <p className="ht-a is-err">✕ {c.err}</p> : <p className="ht-a ht-wait">답변 기다리는 중…</p>}
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="ht-ask-form">
        <input name="question" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 지금 막힌 태스크가 뭐야…" aria-label="마스터에게 보낼 질문" maxLength={2000} />
        <button type="submit" className="btn is-primary" disabled={busy || !q.trim()}>보내기</button>
      </form>
    </div>
  )
}

/* ---------- 알림 ---------- */

const NOTIFY: Envelope['type'][] = ['HUMAN_REQUIRED', 'APPROVE', 'PAUSED', 'RESUMED', 'STATE_CHANGE']
const READ_KEY = 'newteam.notifications.read'

interface Item { id: string; title: string; detail: string; at: string; href: string; urgent: boolean }

function fromEvent(e: Envelope): Item {
  const p = (e.payload ?? {}) as Record<string, unknown>
  const reason = typeof p.reason === 'string' ? reasonLabel(p.reason) : ''
  const task = typeof e.task === 'string' ? e.task : ''
  const title = e.type === 'HUMAN_REQUIRED' ? `사람 필요${reason ? ` · ${reason}` : ''}`
    : e.type === 'STATE_CHANGE' ? `단계 변경${typeof p.to === 'string' ? ` → ${p.to}` : ''}`
    : `${typeLabel[e.type]}${task ? ` · ${task}` : ''}`
  const at = new Date(e.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return { id: e.id, title, detail: `${e.from} → ${e.to}`, at, href: '#/run', urgent: e.type === 'HUMAN_REQUIRED' }
}

export function NotificationPanel({ myTurn }: { myTurn: MyTurn[] }) {
  const [events, setEvents] = useState<Item[]>([])
  const [read, setRead] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[]) } catch { return new Set() }
  })
  useEffect(() => {
    let off = false
    const load = () => { void api.events().then((list) => { if (!off) setEvents(list.filter((e) => NOTIFY.includes(e.type)).slice(-20).reverse().map(fromEvent)) }, () => undefined) }
    load()
    const id = setInterval(load, 30_000)
    return () => { off = true; clearInterval(id) }
  }, [])
  const items: Item[] = [
    ...myTurn.map((t) => ({ id: `turn-${t.id}`, title: t.title, detail: t.detail, at: t.at, href: t.href, urgent: t.kind === 'deadlock' })),
    ...events,
  ]
  const unread = items.filter((i) => !read.has(i.id)).length
  const save = (s: Set<string>) => { setRead(s); try { localStorage.setItem(READ_KEY, JSON.stringify([...s].slice(-500))) } catch { /* 저장 불가 시 이번 화면에서만 */ } }
  return (
    <Popover label="알림" icon={<IconBell />} badge={unread}>
      {(close) => (
        <div className="ht-notes">
          <header><strong>알림</strong><button type="button" className="ht-link" onClick={() => save(new Set(items.map((i) => i.id)))} disabled={unread === 0}>모두 읽음</button></header>
          <ul>
            {items.length === 0 && <li className="ht-empty">새 알림 없음</li>}
            {items.map((i) => (
              <li key={i.id} className={`${read.has(i.id) ? 'is-read' : ''}${i.urgent ? ' is-urgent' : ''}`}>
                <a href={i.href} onClick={() => { save(new Set([...read, i.id])); close() }}>
                  <span className="ht-note-dot" aria-label={read.has(i.id) ? '읽음' : '안 읽음'} />
                  <span className="ht-note-body"><strong>{i.urgent ? '✕ ' : ''}{i.title}</strong><small>{i.detail}</small></span>
                  <small>{i.at}</small>
                </a>
              </li>
            ))}
          </ul>
          <p className="ht-foot">Telegram으로도 같은 알림이 갑니다(연결된 경우)</p>
        </div>
      )}
    </Popover>
  )
}

/* ---------- 설정 ---------- */

const ROLE_LABEL: Record<string, string> = { master: '마스터', planner: '기획', dev: '개발', qa: 'QA', reviewer: '검수', wiki: '위키', logQuery: '로그 질문' }

export function SettingsPanel() {
  return (
    <Popover label="설정" icon={<IconGear />} wide>
      {() => <Settings />}
    </Popover>
  )
}

function Settings() {
  const [agents, setAgents] = useState<AgentConfig | null>(null)
  const [tg, setTg] = useState<TelegramStatus | null>(null)
  const [vault, setVault] = useState<VaultSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void api.agents().then(setAgents, (e) => setErr(e instanceof Error ? e.message : String(e)))
    void api.telegram().then(setTg)
    void api.vault().then(setVault)
  }, [])
  return (
    <div className="ht-settings">
      <header><strong>설정</strong><small>오케스트레이터에서 읽은 현재 값</small></header>
      <section>
        <h3>역할별 모델</h3>
        {err ? <p className="ht-empty">✕ 오케스트레이터에 연결되지 않음 ({err})</p> : !agents ? <p className="ht-empty">불러오는 중…</p> : (
          <table className="ht-table">
            <tbody>
              {Object.entries(agents.roles).map(([role, r]) => (
                <tr key={role}><th scope="row">{ROLE_LABEL[role] ?? role}</th><td>{r.provider === 'claude' ? 'Claude' : 'Codex'}</td><td className="mono">{r.model}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ht-hint">변경: PC에서 <code>npx tsx src/cli.ts configure</code> 실행 후 서버 재시작. 스킬별 모델은 스킬 카드의 옵션에서 고릅니다.</p>
      </section>
      <section>
        <h3>연결</h3>
        <ul className="ht-status">
          <li><span>Telegram</span><span>{!tg ? '…' : tg.state === 'connected' ? `● 연결됨${tg.botUsername ? ` @${tg.botUsername}` : ''}` : tg.state === 'error' ? '✕ 끊김' : tg.state === 'connecting' ? '연결 중' : '○ 꺼짐'}</span></li>
          <li><span>Obsidian</span><span>{!vault ? '…' : vault.state === 'connected' ? `● ${vault.name} · 노트 ${vault.total}` : vault.state === 'error' ? '✕ 오류' : '○ 꺼짐'}</span></li>
          {vault?.state === 'connected' && <li><span>검색 허용</span><span>{vault.readFolders.join(', ')}</span></li>}
          {vault?.state === 'connected' && <li><span>AI 결과 저장</span><span>{vault.inbox}</span></li>}
        </ul>
      </section>
      <section>
        <h3>API 키·토큰</h3>
        <p className="ht-hint">화면에 저장하지 않습니다. PC 환경 변수로 넣습니다: <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_CHAT_ID</code>, <code>OPENAI_API_KEY</code>(예비), <code>ORCH_VAULT_DIR</code>. 채널(WordPress·Instagram·Threads·YouTube) 키는 채널 연결 단계에서 같은 방식으로 추가합니다.</p>
      </section>
    </div>
  )
}
