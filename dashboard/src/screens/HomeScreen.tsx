import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHashParam } from '../api/hashState'
import { api, type DashboardUsage, type LibraryKind, type ProjectSummary, type SkillRun, type VaultGraph, type VaultHit, type VaultSummary } from '../api/client'
import type { RunView } from '../api/useRun'
import { forceLayout } from '../model/forceLayout'
import { PIPELINE_DEFAULTS } from '../model/pipeline'
import { yearMonth } from '../model/time'
import { StageRail } from '../components/StageRail'
import { SectionIcon } from '../components/SectionIcons'
import { TelegramChip } from '../components/TelegramChip'
import { Clock, MessagePanel, NotificationPanel, SettingsPanel } from '../components/HeaderTools'
import { Section } from '../components/HomeSection'
import { SkillsCard } from '../components/SkillsCard'
import { RoutinesCard } from '../components/RoutinesCard'
import { UsageGauges } from '../components/UsageGauges'
import { usageView, type UsageView } from '../model/usage'
import {
  boards, brain, calendar, channels, goals, myTurn, obsidianLastSync, projects,
  todayTasks, type BrainCluster, type Channel, type MyTurn,
} from '../model/homeMock'

/*
 * 통합 홈. 관제가 먼저다(PRODUCT.md 원칙 1): 사람이 할 일과 진행 상태를 첫 열에 둔다.
 *   첫 열(관제): 내 차례 → 진행 중 → 루틴
 *   가운데: 캘린더 → 스킬 → 세컨드 브레인(작게)
 *   오른쪽: 채널 지표 → 목표(접힘) → 최근 산출물(접힘) → 다른 대시보드(접힘)
 */

const nf = new Intl.NumberFormat('ko-KR')
const fmt = (n: number | null) => (n === null ? '—' : nf.format(n))
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']


/** 접히는 한 줄 섹션(참고 이미지의 '목표 ›', '최근 파일 ›'). */
function Fold({ title, meta, area, children }: { title: string; meta?: ReactNode; area: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={`hs ha-${area} hs-fold`} aria-label={title}>
      <button type="button" className="hs-head hs-fold-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="hs-icon" aria-hidden="true"><SectionIcon name={area} /></span>
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

/** 고정 헤더는 화면 폭에 따라 줄이 바뀐다. 실제 높이를 --sticky-offset으로 알려 스크롤 대상이 가리지 않게 한다. */
function useStickyOffset() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const apply = (h: number) => root.style.setProperty('--sticky-offset', `${Math.ceil(h) + 12}px`)
    apply(el.getBoundingClientRect().height)
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(([entry]) => apply(entry!.borderBoxSize[0]!.blockSize))
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--sticky-offset') }
  }, [])
  return ref
}

function HomeTop({ project, onProject, usage }: { project: string; onProject: (p: string) => void; usage: UsageView }) {
  const ref = useStickyOffset()
  return (
    <header className="ht" ref={ref}>
      <a className="ht-brand" href="#/">NEWTEAM</a>
      <span className="ht-sub">AGENT STUDIO</span>
      <label className="ht-project">
        <span className="sr-only">현재 프로젝트</span>
        <select value={project} onChange={(e) => onProject(e.target.value)}>
          <option value="">전체 프로젝트</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <span className="ht-sample" title="사용량은 실제 실행 기록이며, 나머지 홈 업무 데이터 일부는 예시입니다">업무 데이터 일부 목업</span>
      <div className="ht-right">
        <UsageGauges usage={usage} />
        <TelegramChip />
        <Clock />
        <MessagePanel />
        <NotificationPanel myTurn={myTurn} />
        <SettingsPanel />
        <a className="btn is-primary ht-new" href="#/run">+ 새 작업</a>
      </div>
    </header>
  )
}

/* ---------- 왼쪽 ---------- */

function channelState(c: Channel) {
  if (c.status === 'connected') return <Dot tone="ok">갱신 · {c.updatedAt} 기준</Dot>
  if (c.status === 'error') return <Dot tone="bad">연결 오류 · 키 확인 필요</Dot>
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
    <Fold area="goals" title="목표" meta="11/1 ~ 12/31 · D-60">
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

export function Calendar({ usage }: { usage: UsageView }) {
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
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const usageByDay = new Map(usage.byDay.filter((d) => d.date.startsWith(monthKey)).map((d) => [Number(d.date.slice(8)), d]))
  const selectedUsage = usageByDay.get(selected)
  return (
    <Section area="calendar" title="캘린더" meta="일정·실행·게시"
      action={
        <span className="hs-month mono">{yearMonth(new Date(year, month - 1, 1))}</span>
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
                      aria-pressed={d === selected} aria-label={`${month}월 ${d}일 일정 ${counts[d] ?? 0}건, 토큰 ${nf.format(usageByDay.get(d)?.tokens ?? 0)}개`} onClick={() => setSelected(d)}>
                      <span aria-hidden="true">{d}</span>
                      {(usageByDay.get(d)?.tokens ?? 0) > 0 && <small className="hs-day-token" aria-hidden="true">{compactTokens(usageByDay.get(d)!.tokens)}</small>}
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
        <span className="hs-cal-usage mono">토큰 {nf.format(selectedUsage?.tokens ?? 0)}{selectedUsage?.hasCost ? ` · $${selectedUsage.costUsd.toFixed(2)}` : ''}</span>
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

/** 최근 산출물: 끝난 스킬 실행(루틴 포함) 중 결과가 있는 것. 누르면 #/outputs/<실행 ID> 상세 페이지. */
function OutputsFold() {
  const [runs, setRuns] = useState<SkillRun[] | null>(null)
  useEffect(() => { api.skillRuns().then(setRuns).catch(() => setRuns([])) }, [])
  const done = (runs ?? []).filter((r) => r.status === 'done' && (r.text || r.files?.length)).slice(0, 5)
  return (
    <Fold area="outputs" title="최근 산출물" meta={runs ? `${done.length}건 · 스킬 실행 결과` : '불러오는 중…'}>
      <ul className="hs-list">
        {done.map((r) => (
          <li key={r.id}>
            <a className="hs-row hs-output" href={`#/outputs/${encodeURIComponent(r.id)}`}>
              <span className="hs-grow">{r.input.split('\n')[0]?.slice(0, 60) || r.skill}<small>{r.skill}{r.routine ? ` · 루틴 ${r.routine}` : ''}{r.files?.length ? ` · 파일 ${r.files.length}` : ''}</small></span>
              <span className="hs-meta">{outputTime.format(new Date(r.endedAt ?? r.startedAt))}</span>
            </a>
          </li>
        ))}
        {runs && done.length === 0 && <li className="hs-meta">아직 산출물이 없습니다. 스킬을 실행하면 결과가 여기 쌓입니다.</li>}
      </ul>
    </Fold>
  )
}
const outputTime = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** 라이브러리 세 곳의 개수는 Vault(Libraries/…)에서 실제 노트 수를 읽는다. 못 읽으면 개수를 빼고 설명만 보인다. */
function useLibraryCounts(): Partial<Record<LibraryKind, number>> {
  const [counts, setCounts] = useState<Partial<Record<LibraryKind, number>>>({})
  useEffect(() => {
    let alive = true
    for (const kind of ['brand', 'content', 'ideas'] as const) {
      api.library(kind).then((list) => { if (alive) setCounts((c) => ({ ...c, [kind]: list.length })) }).catch(() => undefined)
    }
    return () => { alive = false }
  }, [])
  return counts
}

function Boards() {
  const live = useLibraryCounts()
  const countOf = (b: (typeof boards)[number]) => (b.id in live ? live[b.id as LibraryKind]! : b.count)
  return (
    <Fold area="boards" title="다른 대시보드" meta={`${boards.filter((b) => b.href).length}개 사용 가능 · ${boards.filter((b) => !b.href).length}개 준비 중`}>
      <ul className="hs-boards">
        {boards.map((b) => {
          const body = (<><span className="hs-tile" aria-hidden="true"><SectionIcon name={b.icon} size={18} /></span><span className="hs-grow"><strong>{b.title}</strong><small>{countOf(b) !== null ? `${countOf(b)}개 · ` : ''}{b.desc}{b.href ? '' : ' · 준비 중'}</small></span><span className="hs-arrow" aria-hidden="true">›</span></>)
          return <li key={b.id}>{b.href ? <a href={b.href} className="hs-board">{body}</a> : <span className="hs-board is-disabled" aria-disabled="true">{body}</span>}</li>
        })}
      </ul>
    </Fold>
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
        // 키보드·스크린리더는 위 분류 버튼으로 같은 일을 한다. 그림 속 군집은 마우스용 지름길이다.
        <g key={n.key} className={`hb-cluster${selected === n.key ? ' is-on' : ''}${selected && selected !== n.key ? ' is-dim' : ''}`}
          onClick={() => onSelect(n.key)}>
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
/** Tab으로 들르는 노트 수. 나머지는 검색으로 연다(수백 개의 탭 정지를 막는다). */
const FOCUSABLE_GRAPH_NODES = 20
/** 이보다 점이 많으면 번짐(blur) 필터를 끈다. 필터 비용은 점 수에 비례한다. */
const GLOW_MAX_NODES = 300
const short = (t: string) => (t.length > 16 ? `${t.slice(0, 15)}…` : t)

/** Obsidian 그래프 보기와 같은 데이터(노트=점, [[링크]]=선)를 그린다. 점 크기는 연결 수, 이름은 연결이 많은 노트만. */
function NoteGraph({ graph, vaultName, group }: { graph: VaultGraph; vaultName: string; group: string | null }) {
  const W = 760, H = 620
  const [hover, setHover] = useState<string | null>(null)
  const { nodes, links, meta } = useMemo(() => {
    const kept = [...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, MAX_GRAPH_NODES)
    const ids = new Set(kept.map((n) => n.id))
    const ls = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target))
    // 쌍 계산 수가 약 1,000만 번을 넘지 않게 반복 횟수를 줄인다(600노드면 60회). 메인 스레드가 오래 멈추지 않게.
    const pairs = Math.max(1, (kept.length * (kept.length - 1)) / 2)
    const laid = forceLayout(kept, ls, { width: W, height: H, iterations: Math.max(60, Math.min(260, Math.round(1e7 / pairs))) })
    const meta = new Map(kept.map((n) => [n.id, n]))
    return { nodes: laid, links: ls, meta }
  }, [graph])
  const pos = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const byDegree = useMemo(() => [...nodes].sort((a, b) => b.degree - a.degree).map((n) => n.id), [nodes])
  const labelled = useMemo(() => new Set(byDegree.slice(0, 6)), [byDegree])
  const focusable = useMemo(() => new Set(byDegree.slice(0, FOCUSABLE_GRAPH_NODES)), [byDegree])
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
      <g filter={nodes.length <= GLOW_MAX_NODES ? 'url(#hb-glow)' : undefined}>
        {nodes.map((n) => {
          const m = meta.get(n.id)!
          const r = 3 + Math.sqrt(n.degree) * 2.6
          const href = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(n.id.replace(/\.md$/, ''))}`
          return (
            <a key={n.id} href={href} tabIndex={focusable.has(n.id) ? undefined : -1} className={`hb-node${dim(n.id) ? ' is-dim' : ''}${hover === n.id ? ' is-on' : ''}`} aria-label={`${m.title} · 연결 ${n.degree}`}
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
  const searchRef = useRef<HTMLDivElement>(null)
  // 결과 목록이 열려 있으면 검색창·목록 밖을 누르거나 Esc로 닫는다(헤더 팝오버와 같은 방식).
  useEffect(() => {
    if (!hits) return
    const onDown = (e: MouseEvent) => { if (!searchRef.current?.contains(e.target as Node)) setHits(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHits(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [hits])
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
        <span className="hs-icon" aria-hidden="true"><SectionIcon name="brain" /></span>
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
      <div ref={searchRef}>
      <form className="hb-search" onSubmit={search}>
        <input type="search" name="vault-q" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} aria-label="세컨드 브레인 검색" disabled={!live}
          placeholder={!live ? 'Obsidian 연결 후 검색할 수 있습니다' : selected ? `${data.find((b) => b.key === selected)?.label}에서 검색…` : '노트 검색…'} />
        <button type="submit" className="btn" disabled={!live}>검색</button>
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
      </div>
      {openHref ? <a className="hb-open" href={openHref}>Obsidian에서 열기 ↗</a> : <span className="hb-open is-disabled">Obsidian 연결 후 열 수 있습니다</span>}
    </section>
  )
}

/* ---------- 오른쪽 ---------- */

const TURN_LABEL: Record<MyTurn['kind'], string> = { spec: '스펙 승인', deadlock: '교착 · 해결 필요', publish: '게시 승인' }
// 교착이 가장 드물고 무겁다. 시간보다 긴급도 순으로 놓는다.
const TURN_ORDER: Record<MyTurn['kind'], number> = { deadlock: 0, spec: 1, publish: 2 }

/** 단축키: i = 내 차례로, j/k(또는 ↓/↑) = 항목 이동, Enter = 열기. 입력 중일 때는 동작하지 않는다. */
function useTurnKeys() {
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      const links = [...document.querySelectorAll<HTMLAnchorElement>('#my-turn .hs-mail a')]
      if (!links.length) return
      const at = links.indexOf(document.activeElement as HTMLAnchorElement)
      let next = -1
      if (e.key === 'i') next = 0
      else if (at >= 0 && (e.key === 'j' || e.key === 'ArrowDown')) next = Math.min(links.length - 1, at + 1)
      else if (at >= 0 && (e.key === 'k' || e.key === 'ArrowUp')) next = Math.max(0, at - 1)
      if (next < 0) return
      e.preventDefault()
      links[next]!.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

function MyTurnInbox({ project }: { project: string }) {
  useTurnKeys()
  const items = myTurn.filter((t) => !project || t.project === project).sort((x, y) => TURN_ORDER[x.kind] - TURN_ORDER[y.kind])
  return (
    <Section id="my-turn" area="turn" title="내 차례" meta={<><b className="hs-count">{items.length}</b> 승인·교착·게시</>}>
      {items.length === 0 ? <p className="hs-meta">지금은 할 일이 없습니다. 에이전트가 계속 진행합니다.</p> : (
        <ul className="hs-inbox">
          {items.map((t) => (
            <li key={t.id} className={`hs-mail is-${t.kind}`}>
              <a href={t.href} className="hs-grow">
                <span className="hs-mail-kind">{TURN_LABEL[t.kind]}</span>
                <strong>{t.title}</strong>
                <span className="hs-mail-detail">{t.detail}</span>
                {t.kind === 'deadlock' && <span className="hs-mail-rule">반려 {PIPELINE_DEFAULTS.rejectLimit}회 또는 같은 지적 {PIPELINE_DEFAULTS.repeatFindingLimit}회면 교착입니다. 마스터가 풀지 못해 사람에게 넘어왔고, 이 태스크는 멈춰 있습니다.</span>}
              </a>
              <span className="hs-meta">{t.at}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hs-meta hs-keys"><kbd>i</kbd> 내 차례 · <kbd>j</kbd>/<kbd>k</kbd> 이동 · <kbd>Enter</kbd> 열기</p>
    </Section>
  )
}

/** 진행 중: 서버가 연 실제 프로젝트들. 누르면 그 프로젝트만의 관제 페이지(#/run/<이름>). */
function Runs() {
  const [list, setList] = useState<ProjectSummary[] | null>(null)
  const [usage, setUsage] = useState<DashboardUsage>()
  useEffect(() => {
    const load = () => {
      api.projects().then(setList).catch(() => setList([]))
      api.usageAll().then(setUsage).catch(() => undefined)
    }
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])
  const tokensOf = (name: string) => usage?.projects.find((p) => p.name === name)
  return (
    <Section area="runs" title="진행 중" meta={list ? `${list.length}개 프로젝트` : '불러오는 중…'}>
      <ul className="hs-list">
        {list?.length === 0 && <li className="hs-meta">열린 프로젝트가 없습니다. 오케스트레이터가 켜져 있는지 확인하세요.</li>}
        {list?.map((p) => {
          const u = tokensOf(p.name)
          const state = p.stage === 'DONE' ? '완료' : p.stage === 'INTAKE' ? '요구사항' : p.pipeline === 'running' ? '실행 중' : p.pipeline === 'stopped' ? '정지됨' : '시작 전'
          return (
            <li key={p.name}>
              <a href={`#/run/${encodeURIComponent(p.name)}`} className="hs-run">
                <span className="hs-row"><strong>{p.displayName}</strong><small>{state}</small></span>
                <StageRail stage={p.stage} />
                <small className="hs-run-usage mono">{u ? `토큰 ${nf.format(u.tokens)} · 기록 비용 ${u.hasCost ? `$${u.costUsd.toFixed(2)}` : '—'}` : '사용량 불러오는 중'}</small>
              </a>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/* ---------- 화면 ---------- */

// 해시 라우터라 기본 앵커 이동 대신 직접 포커스를 옮긴다.
function skipToTurn(e: React.MouseEvent) {
  e.preventDefault()
  const el = document.getElementById('my-turn')
  el?.focus()
  el?.scrollIntoView({ block: 'start' })
}

const compactTokens = (tokens: number) => tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}m` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens)

export function HomeScreen({ run }: { run: RunView }) {
  const [project, setProject] = useHashParam<string>('project', '')
  const usage = usageView(run.events, run.state, run.agents, new Date())
  return (
    <div className="home">
      <a className="skip-link" href="#my-turn" onClick={skipToTurn}>내 차례로 건너뛰기</a>
      <HomeTop project={project} onProject={setProject} usage={usage} />
      <main className="hg">
        <h1 className="sr-only">홈 · 관제</h1>
        <div className="hg-col hg-ops">
          <MyTurnInbox project={project} />
          <Runs />
          <GoalsFold />
          <Boards />
        </div>
        <div className="hg-col hg-center">
          <Calendar usage={usage} />
          <SecondBrain />
        </div>
        <div className="hg-col hg-side">
          <Stats />
          <SkillsCard />
          <RoutinesCard />
          <OutputsFold />
        </div>
      </main>
    </div>
  )
}
