import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type VaultGraph, type VaultHit, type VaultSummary } from '../api/client'
import { forceLayout } from '../model/forceLayout'
import { StageRail } from '../components/StageRail'
import { TelegramChip } from '../components/TelegramChip'
import {
  activeRuns, boards, brain, calendar, channels, goals, myTurn, obsidianLastSync, outputs, projects,
  routineRuns, skills, todayTasks, usage, type BrainCluster, type Channel, type MyTurn,
} from '../model/homeMock'

/*
 * 통합 홈. 참고 이미지(CHATdaeri)와 같은 기능은 같은 배치로 둔다.
 *   왼쪽: 채널 지표 카드 → 목표(접힘) → 캘린더(주간 막대 + 선택일 일정) → 최근 산출물(접힘) → 다른 대시보드
 *   가운데: 세컨드 브레인(빛나는 군집 그래프 + 열기 링크)
 *   오른쪽: 내 차례(받은편지함 형식) → 진행 중 실행 → 스킬(검색 + 2열 카드) → 루틴(Windows 예약)
 */

const nf = new Intl.NumberFormat('ko-KR')
const fmt = (n: number | null) => (n === null ? '—' : nf.format(n))
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function Section({ title, icon, meta, area, action, children }: { title: string; icon: string; meta?: ReactNode; area: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className={`hs ha-${area}`} aria-label={title}>
      <header className="hs-head">
        <span className="hs-icon" aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
        {meta !== undefined && <span className="hs-meta">{meta}</span>}
        {action}
      </header>
      {children}
    </section>
  )
}

/** 접히는 한 줄 섹션(참고 이미지의 '목표 ›', '최근 파일 ›'). */
function Fold({ title, icon, meta, area, children }: { title: string; icon: string; meta?: ReactNode; area: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={`hs ha-${area} hs-fold`} aria-label={title}>
      <button type="button" className="hs-head hs-fold-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="hs-icon" aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
        {meta !== undefined && <span className="hs-meta">{meta}</span>}
        <span className="hs-chev" aria-hidden="true">{open ? '⌄' : '›'}</span>
      </button>
      {open && <div className="hs-fold-body">{children}</div>}
    </section>
  )
}

function Dot({ tone, children }: { tone: 'ok' | 'bad' | 'off'; children: ReactNode }) {
  return <span className={`hs-dot is-${tone}`}><i aria-hidden="true">{tone === 'bad' ? '✕' : tone === 'off' ? '○' : '●'}</i>{children}</span>
}

/* ---------- 상단 ---------- */

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id) }, [])
  return now
}

function HomeTop({ project, onProject }: { project: string; onProject: (p: string) => void }) {
  const now = useClock()
  const date = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
  const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  const ratio = Math.min(1, usage.apiSpendUsd / usage.apiCapUsd)
  return (
    <header className="ht">
      <a className="ht-brand" href="#/">NEWTEAM</a>
      <span className="ht-sub">AGENT STUDIO</span>
      <label className="ht-project">
        <span className="sr-only">현재 프로젝트</span>
        <select value={project} onChange={(e) => onProject(e.target.value)}>
          <option value="">전체 프로젝트</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <span className="ht-sample" title="오케스트레이터 홈 API 연결 전 예시 값">목업 데이터</span>
      <div className="ht-right">
        <div className="usage" aria-label="사용량">
          <span className="usage-item"><span className="usage-name">Claude</span><span className="mono">{nf.format(usage.claudeTokens)}</span></span>
          <span className="usage-item"><span className="usage-name">GPT</span><span className="mono">{nf.format(usage.gptTokens)}</span></span>
          <span className="usage-item" title="API 예비 지출 / 상한">
            <span className="usage-name">API</span>
            <span className="mono">{`$${usage.apiSpendUsd.toFixed(2)} / $${usage.apiCapUsd}`}</span>
            <span className="meter" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
          </span>
        </div>
        <TelegramChip />
        <span className="ht-clock mono"><i aria-hidden="true">●</i> {date} {time}</span>
        <a className="ht-ico" href="#/run" aria-label="마스터에게 묻기" title="마스터에게 묻기">💬︎</a>
        <a className="ht-ico" href="#my-turn" aria-label={`내 차례 ${myTurn.length}건`} title="내 차례">
          🔔︎{myTurn.length > 0 && <b className="ht-badge">{myTurn.length}</b>}
        </a>
        <span className="ht-ico is-disabled" aria-disabled="true" title="설정 · 준비 중">⚙︎</span>
        <a className="btn is-primary ht-new" href="#/run">+ 새 작업</a>
      </div>
    </header>
  )
}

/* ---------- 왼쪽 ---------- */

function channelState(c: Channel) {
  if (c.status === 'connected') return <Dot tone="ok">갱신 · {c.updatedAt} 기준</Dot>
  if (c.status === 'error') return <Dot tone="bad">연결 오류 · 재연결 필요</Dot>
  return <Dot tone="off">미연결</Dot>
}

function Stats() {
  return (
    <div className="hs-stats">
      {channels.map((c) => (
        <section key={c.key} className={`hs hs-stat is-${c.status}`} aria-label={`${c.label} ${c.metric}`}>
          <header className="hs-head"><h2>{c.label}</h2></header>
          <p className="hs-big"><strong className="mono">{fmt(c.value)}</strong><small>{c.metric === '조회수' ? '회' : c.metric === '방문' ? '회' : '명'}</small></p>
          <p className="hs-sub">{c.metric}</p>
          <p className="hs-delta">
            {c.delta !== null ? <span className="hs-pill">↑ {nf.format(c.delta)}</span> : <span className="hs-pill is-empty">—</span>}
            <span>전일 대비</span>
          </p>
          <p>{channelState(c)}</p>
        </section>
      ))}
    </div>
  )
}

function GoalsFold() {
  return (
    <Fold area="goals" icon="▥" title="목표" meta="11/1 ~ 12/31 · D-60">
      <ul className="hs-list">
        {goals.map((g) => {
          const pct = g.current === null ? null : Math.min(100, Math.round((g.current / g.target) * 100))
          return (
            <li key={g.id}>
              <div className="hs-row"><span>{g.title}</span><span className="mono">{pct === null ? '데이터 없음' : `${pct}%`}</span></div>
              <div className="hs-bar" role="progressbar" aria-label={g.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}><i style={{ width: `${pct ?? 0}%` }} /></div>
              <small>{g.metric} {fmt(g.current)} / {nf.format(g.target)}{g.unit} · ~{g.due}</small>
            </li>
          )
        })}
      </ul>
    </Fold>
  )
}

function Calendar() {
  const { year, month, today, counts, events } = calendar
  const [selected, setSelected] = useState(today)
  const [done, setDone] = useState(() => new Set(todayTasks.filter((t) => t.done).map((t) => t.id)))
  const first = new Date(year, month - 1, 1).getDay()
  const days = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const weekTotals = weeks.map((w) => w.reduce<number>((a, d) => a + (d ? counts[d] ?? 0 : 0), 0))
  const maxWeek = Math.max(1, ...weekTotals)
  const level = (n: number) => (n <= 0 ? 0 : n >= 4 ? 4 : n)
  const dayEvents = events[selected] ?? []
  const isToday = selected === today
  const dow = WEEKDAYS[new Date(year, month - 1, selected).getDay()]
  const count = dayEvents.length + (isToday ? todayTasks.length : 0)
  return (
    <Section area="calendar" icon="▦" title="캘린더" meta="일정·실행·게시"
      action={
        <span className="hs-month">
          <button type="button" className="hs-nav" aria-label="이전 달" disabled>‹</button>
          <span className="mono">{year}.{String(month).padStart(2, '0')}</span>
          <button type="button" className="hs-nav" aria-label="다음 달" disabled>›</button>
        </span>
      }>
      <table className="hs-cal">
        <thead>
          <tr><th scope="col"><span className="sr-only">주</span></th>{WEEKDAYS.map((d) => <th key={d} scope="col">{d}</th>)}<th scope="col" className="hs-cal-week">주간 일정</th></tr>
        </thead>
        <tbody>
          {weeks.map((w, wi) => (
            <tr key={wi}>
              <th scope="row">{wi + 1}주차</th>
              {w.map((d, di) => (
                <td key={di}>
                  {d && (
                    <button type="button" className={`hs-day lv-${level(counts[d] ?? 0)}${d === selected ? ' is-sel' : ''}${d === today ? ' is-today' : ''}`}
                      aria-pressed={d === selected} aria-label={`${month}월 ${d}일 일정 ${counts[d] ?? 0}건`} onClick={() => setSelected(d)}>
                      {d === today && <i aria-hidden="true" />}
                    </button>
                  )}
                </td>
              ))}
              <td className="hs-cal-week">
                <span className="hs-wbar" aria-hidden="true"><i style={{ width: `${(weekTotals[wi]! / maxWeek) * 100}%` }} /></span>
                <span className="mono">{weekTotals[wi]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hs-row hs-cal-foot">
        <strong>{month}월 {selected}일 ({dow})</strong>
        <span className="hs-meta">일정 {count}건</span>
        <span className="hs-legend" aria-hidden="true">일정 0 {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`lv-${l}`} />)} 4+</span>
      </div>
      <ul className="hs-list hs-events">
        {dayEvents.map((e) => (
          <li key={e.title} className="hs-row"><span className="mono hs-time">{e.time}</span><span className="hs-grow">{e.title}</span><span className="hs-meta">{e.kind}</span></li>
        ))}
        {isToday && todayTasks.map((t) => (
          <li key={t.id}>
            <label className="hs-check">
              <span className="mono hs-time">{t.due}</span>
              <span className={`hs-grow${done.has(t.id) ? ' is-done' : ''}`}>{t.title}</span>
              <input type="checkbox" checked={done.has(t.id)} aria-label={`${t.title} 완료`}
                onChange={() => setDone((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })} />
            </label>
          </li>
        ))}
        {count === 0 && <li className="hs-meta">일정 없음</li>}
      </ul>
    </Section>
  )
}

function OutputsFold() {
  return (
    <Fold area="outputs" icon="↺" title="최근 산출물" meta={`${outputs.length}건 · 근거와 함께`}>
      <ul className="hs-list">
        {outputs.map((o) => (
          <li key={o.id} className="hs-row"><span className="hs-grow">{o.title}<small>{o.kind} · {o.evidence}</small></span><span className="hs-meta">{o.at}</span></li>
        ))}
      </ul>
    </Fold>
  )
}

function Boards() {
  return (
    <Section area="boards" icon="▤" title="다른 대시보드">
      <ul className="hs-boards">
        {boards.map((b) => {
          const body = (<><span className="hs-tile" aria-hidden="true">{b.icon}</span><span className="hs-grow"><strong>{b.title}</strong><small>{b.count !== null ? `${b.count}개 · ` : ''}{b.desc}{b.href ? '' : ' · 준비 중'}</small></span><span className="hs-arrow" aria-hidden="true">↗</span></>)
          return <li key={b.id}>{b.href ? <a href={b.href} className="hs-board">{body}</a> : <span className="hs-board is-disabled" aria-disabled="true">{body}</span>}</li>
        })}
      </ul>
    </Section>
  )
}

/* ---------- 가운데: 세컨드 브레인 ---------- */

function useVault(): VaultSummary | null {
  const [v, setV] = useState<VaultSummary | null>(null)
  useEffect(() => {
    let off = false
    const read = () => { void api.vault().then((r) => { if (!off) setV(r) }) }
    read()
    const id = setInterval(read, 60_000)
    return () => { off = true; clearInterval(id) }
  }, [])
  return v
}

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 } }

/** 큰 군집부터 가운데에 놓고, 나머지는 살짝 겹치게 주변에 붙인다(참고 이미지의 뭉친 배치). */
function pack(data: BrainCluster[], w: number, h: number) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const placed: { x: number; y: number; r: number }[] = []
  return data.map((c, i) => {
    const r = 46 + 92 * Math.sqrt(c.count / max)
    let x = w / 2, y = h / 2
    if (i > 0) {
      search: for (let dist = 20; dist < 600; dist += 6) {
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2 + i * 1.7
          const cx = w / 2 + Math.cos(a) * dist, cy = h / 2 + Math.sin(a) * dist * 0.8
          if (placed.every((p) => Math.hypot(p.x - cx, p.y - cy) > (p.r + r) * 0.86)) { x = cx; y = cy; break search }
        }
      }
    }
    placed.push({ x, y, r })
    const rand = rng(i * 31 + 7)
    const n = Math.min(Math.max(c.count * 6, 40), 420)
    const dots = Array.from({ length: n }, () => {
      const a = rand() * Math.PI * 2
      const d = Math.pow(rand(), 0.55) * r
      return [x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rand() * 2.4, 0.35 + rand() * 0.65] as const
    })
    return { ...c, x, y, r, dots }
  })
}

function BrainGraph({ data, selected, onSelect }: { data: BrainCluster[]; selected: string | null; onSelect: (k: string) => void }) {
  const W = 760, H = 620
  const nodes = useMemo(() => pack(data, W, H), [data])
  return (
    <svg className="hb-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="세컨드 브레인 분류별 노트 분포">
      <defs>
        <radialGradient id="hb-fill"><stop offset="0%" stopColor="#2779a7" stopOpacity="0.55" /><stop offset="70%" stopColor="#2779a7" stopOpacity="0.12" /><stop offset="100%" stopColor="#2779a7" stopOpacity="0" /></radialGradient>
        <filter id="hb-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {nodes.map((n) => (
        <g key={n.key} role="button" tabIndex={0} aria-label={`${n.label} ${n.count}개`} aria-pressed={selected === n.key}
          className={`hb-cluster${selected === n.key ? ' is-on' : ''}${selected && selected !== n.key ? ' is-dim' : ''}`}
          onClick={() => onSelect(n.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.key) } }}>
          <circle cx={n.x} cy={n.y} r={n.r * 1.08} fill="url(#hb-fill)" />
          <g filter="url(#hb-glow)">
            {n.dots.map(([x, y, s, o], j) => <circle key={j} cx={x} cy={y} r={s} className="hb-dot" opacity={o} />)}
          </g>
          <circle cx={n.x} cy={n.y} r={9} className="hb-hub" />
          <circle cx={n.x} cy={n.y} r={3} className="hb-hub-core" />
          <text x={n.x} y={n.y + n.r + 22} textAnchor="middle" className="hb-label">{n.label} {nf.format(n.count)}</text>
        </g>
      ))}
    </svg>
  )
}

const MAX_GRAPH_NODES = 600
const short = (t: string) => (t.length > 16 ? `${t.slice(0, 15)}…` : t)

/** Obsidian 그래프 보기와 같은 데이터(노트=점, [[링크]]=선)를 그린다. 점 크기는 연결 수, 이름은 연결이 많은 노트만. */
function NoteGraph({ graph, vaultName, group }: { graph: VaultGraph; vaultName: string; group: string | null }) {
  const W = 760, H = 620
  const [hover, setHover] = useState<string | null>(null)
  const { nodes, links, meta } = useMemo(() => {
    const kept = [...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, MAX_GRAPH_NODES)
    const ids = new Set(kept.map((n) => n.id))
    const ls = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target))
    const laid = forceLayout(kept, ls, { width: W, height: H })
    const meta = new Map(kept.map((n) => [n.id, n]))
    return { nodes: laid, links: ls, meta }
  }, [graph])
  const pos = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const labelled = useMemo(() => new Set([...nodes].sort((a, b) => b.degree - a.degree).slice(0, 6).map((n) => n.id)), [nodes])
  const neighbours = useMemo(() => {
    if (!hover) return null
    const set = new Set([hover])
    for (const l of links) { if (l.source === hover) set.add(l.target); if (l.target === hover) set.add(l.source) }
    return set
  }, [hover, links])
  const dim = (id: string) => (neighbours ? !neighbours.has(id) : group ? meta.get(id)?.group !== group : false)
  return (
    <svg className="hb-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Obsidian 노트 그래프: 노트 ${nodes.length}개, 링크 ${links.length}개`}>
      <defs>
        <filter id="hb-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <g className="hb-links">
        {links.map((l) => {
          const a = pos.get(l.source)!, b = pos.get(l.target)!
          const on = neighbours ? neighbours.has(l.source) && neighbours.has(l.target) && (l.source === hover || l.target === hover) : false
          return <line key={`${l.source}>${l.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={on ? 'is-on' : dim(l.source) || dim(l.target) ? 'is-dim' : ''} />
        })}
      </g>
      <g filter="url(#hb-glow)">
        {nodes.map((n) => {
          const m = meta.get(n.id)!
          const r = 3 + Math.sqrt(n.degree) * 2.6
          const href = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(n.id.replace(/\.md$/, ''))}`
          return (
            <a key={n.id} href={href} className={`hb-node${dim(n.id) ? ' is-dim' : ''}${hover === n.id ? ' is-on' : ''}`} aria-label={`${m.title} · 연결 ${n.degree}`}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}>
              <title>{`${m.title}\n${n.id}\n연결 ${n.degree}`}</title>
              <circle cx={n.x} cy={n.y} r={r} />
            </a>
          )
        })}
      </g>
      {nodes.filter((n) => labelled.has(n.id) || n.id === hover).map((n) => (
        <text key={n.id} x={n.x} y={n.y - (5 + Math.sqrt(n.degree) * 2.6)} textAnchor="middle" className={`hb-label${dim(n.id) ? ' is-dim' : ''}`}>{short(meta.get(n.id)!.title)}</text>
      ))}
    </svg>
  )
}

function useVaultGraph(enabled: boolean, stamp: string | undefined): VaultGraph | null {
  const [g, setG] = useState<VaultGraph | null>(null)
  useEffect(() => {
    if (!enabled) { setG(null); return }
    let off = false
    void api.vaultGraph().then((r) => { if (!off) setG(r) }, () => { if (!off) setG(null) })
    return () => { off = true }
  }, [enabled, stamp])
  return g
}

function SecondBrain() {
  const vault = useVault()
  const live = vault?.state === 'connected' ? vault : null
  const data = [...(live ? live.groups : brain)].sort((x, y) => y.count - x.count)
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<VaultHit[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const total = data.reduce((a, c) => a + c.count, 0)
  const toggle = (k: string) => setSelected((s) => (s === k ? null : k))
  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    if (!live) { setErr('Obsidian이 연결되면 검색할 수 있습니다'); setHits(null); return }
    try { setErr(null); setHits(await api.vaultSearch(q.trim(), selected ?? undefined)) } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setHits(null) }
  }
  const openHref = live ? `obsidian://open?vault=${encodeURIComponent(live.name)}` : undefined
  const graph = useVaultGraph(!!live, live?.scannedAt)
  return (
    <section className="hs hb ha-brain" aria-label="세컨드 브레인">
      <header className="hs-head">
        <span className="hs-icon" aria-hidden="true">◎</span>
        <h2>세컨드 브레인</h2>
        <span className="hs-meta">
          {live ? `Obsidian 기준 · 노트 ${nf.format(total)}${live.truncated ? '+' : ''}` : vault?.state === 'error' ? 'Obsidian 연결 오류 · 예시 값' : `Obsidian 연결 안 됨 · 예시 값 · ${obsidianLastSync}`}
          {live && graph && ` · 링크 ${nf.format(graph.links.length)}`}
          {live && ` · AI Inbox ${live.inboxCount}`}
        </span>
      </header>
      <div className="hb-groups" role="group" aria-label="분류로 강조">
        {data.map((c) => (
          <button key={c.key} type="button" aria-pressed={selected === c.key} onClick={() => toggle(c.key)}>{c.label} <span className="mono">{nf.format(c.count)}</span></button>
        ))}
      </div>
      <div className="hb-body">
        {live && graph ? (graph.nodes.length === 0 ? <p className="hs-meta">허용 폴더에 노트가 없습니다</p> : <NoteGraph graph={graph} vaultName={live.name} group={selected} />)
          : data.length === 0 ? <p className="hs-meta">허용 폴더에 노트가 없습니다</p> : <BrainGraph data={data} selected={selected} onSelect={toggle} />}
      </div>
      <ul className="sr-only" aria-label="분류별 노트 수">{data.map((c) => <li key={c.key}>{c.label} {c.count}</li>)}</ul>
      <form className="hb-search" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="세컨드 브레인 검색"
          placeholder={selected ? `${data.find((b) => b.key === selected)?.label}에서 검색` : '노트 검색'} />
        <button type="submit" className="btn">검색</button>
      </form>
      {err && <p className="hs-meta hb-msg" role="status">{err}</p>}
      {hits && (
        <ul className="hs-list hb-hits" aria-label="검색 결과">
          {hits.length === 0 && <li className="hs-meta">결과 없음</li>}
          {hits.map((h) => (
            <li key={h.path}>
              <a href={`obsidian://open?vault=${encodeURIComponent(live?.name ?? '')}&file=${encodeURIComponent(h.path.replace(/\.md$/, ''))}`}>
                <strong>{h.title}</strong><small>{h.path}</small><span>{h.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {openHref ? <a className="hb-open" href={openHref}>눌러서 세컨드 브레인 열기 ↗</a> : <span className="hb-open is-disabled">Obsidian 연결 후 열 수 있습니다</span>}
    </section>
  )
}

/* ---------- 오른쪽 ---------- */

const TURN_LABEL: Record<MyTurn['kind'], string> = { spec: '스펙 승인', deadlock: '교착 · 해결 필요', publish: '게시 승인' }

function MyTurnInbox() {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  return (
    <Section area="turn" icon="✉" title="내 차례" meta={<><b className="hs-count">{myTurn.length}</b> 승인·교착·게시</>}>
      <ul className="hs-inbox" id="my-turn">
        {myTurn.map((t) => (
          <li key={t.id} className={`hs-mail is-${t.kind}`}>
            <input type="checkbox" aria-label={`${t.title} 선택`} checked={checked.has(t.id)}
              onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })} />
            <i className="hs-unread" aria-label={t.kind === 'deadlock' ? '긴급' : '새 항목'} />
            <a href={t.href} className="hs-grow">
              <strong>{t.title}</strong>
              <span className="hs-mail-kind">{TURN_LABEL[t.kind]} · {t.detail}</span>
            </a>
            <span className="hs-meta">{t.at}</span>
          </li>
        ))}
      </ul>
      <p className="hs-meta hs-foot">09:05 확인 · 최근 {myTurn.length}건</p>
    </Section>
  )
}

function Runs() {
  return (
    <Section area="runs" icon="▶" title="진행 중 실행" meta={`${activeRuns.length}개`}>
      <ul className="hs-list">
        {activeRuns.map((r) => (
          <li key={r.id}>
            <a href="#/run" className="hs-run">
              <span className="hs-row"><strong>{r.title}</strong><small>{r.project}</small></span>
              <StageRail stage={r.stage} />
              <small>{r.note}</small>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Skills() {
  const [q, setQ] = useState('')
  const shown = skills.filter((s) => `${s.name} ${s.desc}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Section area="skills" icon="✦" title="스킬" meta={skills.length}
      action={<input className="hs-skill-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="⌕ 스킬 검색" aria-label="스킬 검색" />}>
      <ul className="hs-skills">
        {shown.map((s) => (
          <li key={s.id} className="hs-skill">
            <span className="hs-skill-name"><span className="hs-meta">{s.maker} · </span><strong>{s.name}</strong></span>
            <small>{s.desc}</small>
            <a className="hs-play" href="#/run"><span aria-hidden="true">▶</span>{s.state === 'input' ? '입력 화면' : '준비됨'}</a>
          </li>
        ))}
        {shown.length === 0 && <li className="hs-meta">일치하는 스킬 없음</li>}
      </ul>
    </Section>
  )
}

function RoutineList() {
  return (
    <Section area="routines" icon="⟳" title="루틴" meta="Windows · PC 켜져 있을 때">
      <ul className="hs-list">
        {routineRuns.map((r) => (
          <li key={r.id} className="hs-routine">
            <span className="hs-row"><strong>{r.name}</strong><span className="hs-badge">{r.platform}</span></span>
            <small>{r.schedule}</small>
            <small className="hs-last">{r.last} · {r.result === '실패' ? <b>✕ 실패</b> : r.result}</small>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/* ---------- 화면 ---------- */

export function HomeScreen() {
  const [project, setProject] = useState('')
  return (
    <div className="home">
      <HomeTop project={project} onProject={setProject} />
      <main className="hg">
        <div className="hg-col hg-left">
          <Stats />
          <GoalsFold />
          <Calendar />
          <OutputsFold />
          <Boards />
        </div>
        <div className="hg-col hg-center">
          <SecondBrain />
        </div>
        <div className="hg-col hg-right">
          <MyTurnInbox />
          <Runs />
          <Skills />
          <RoutineList />
        </div>
      </main>
    </div>
  )
}
