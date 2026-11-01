import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type VaultHit, type VaultSummary } from '../api/client'
import { StageRail } from '../components/StageRail'
import { TelegramChip } from '../components/TelegramChip'
import {
  activeRuns, brain, channels, goals, myTurn, obsidianLastSync, outputs, projects, quickStarts,
  routines, todayTasks, usage, week, type BrainCluster, type Channel, type MyTurn,
} from '../model/homeMock'

const nf = new Intl.NumberFormat('ko-KR')
const fmt = (n: number | null) => (n === null ? '—' : nf.format(n))

/** 메뉴는 대시보드에 필요한 만큼 둔다. 아직 화면이 없는 항목은 숨기지 않고 사유를 보여준다. */
export const NAV: { href: string | null; label: string; reason?: string }[] = [
  { href: '#/', label: '홈' },
  { href: '#/run', label: '실행 관제' },
  { href: null, label: '프로젝트', reason: '프로젝트 목록 API 준비 중' },
  { href: null, label: '콘텐츠·캘린더', reason: '콘텐츠 상태 모델 준비 중' },
  { href: null, label: '채널', reason: 'WordPress 연결부터 구현 예정' },
  { href: null, label: '라이브러리', reason: '브랜드·콘텐츠 에셋 저장 준비 중' },
  { href: null, label: '세컨드 브레인', reason: 'Obsidian 연결기 준비 중' },
  { href: null, label: '작업 팩·루틴', reason: '작업 팩 설정 화면 준비 중' },
  { href: null, label: '설정', reason: 'Telegram·모델 참조 설정 준비 중' },
]

function Panel({ title, meta, href, area, children }: { title: string; meta?: ReactNode; href?: string; area?: string; children: ReactNode }) {
  return (
    <section className={`home-panel${area ? ` home-a-${area}` : ''}`} aria-label={title}>
      <header className="home-panel-head">
        <h2>{title}</h2>
        {meta !== undefined && <span className="home-meta">{meta}</span>}
        {href && <a className="home-more" href={href} aria-label={`${title} 자세히`}>›</a>}
      </header>
      {children}
    </section>
  )
}

/** 상태는 아이콘 + 문구로 구분한다. 색은 보조다. */
function State({ tone, children }: { tone: 'ok' | 'bad' | 'warn' | 'off'; children: ReactNode }) {
  const icon = { ok: '●', bad: '✕', warn: '▲', off: '○' }[tone]
  return <span className={`home-state is-${tone}`}><span aria-hidden="true">{icon}</span> {children}</span>
}

const TURN_LABEL: Record<MyTurn['kind'], string> = { spec: '스펙 승인', deadlock: '교착', publish: '게시 승인' }

/* ---------- 상단 ---------- */

function HomeTop({ project, onProject }: { project: string; onProject: (p: string) => void }) {
  const ratio = Math.min(1, usage.apiSpendUsd / usage.apiCapUsd)
  return (
    <header className="topbar home-top">
      <h1 className="topbar-title">NEWTEAM</h1>
      <label className="home-project">
        <span className="sr-only">현재 프로젝트</span>
        <select value={project} onChange={(e) => onProject(e.target.value)}>
          <option value="">전체 프로젝트</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <span className="home-sample" title="오케스트레이터 홈 API 연결 전 예시 값">목업 데이터</span>
      <div className="topbar-right">
        <div className="usage" aria-label="사용량">
          <span className="usage-item"><span className="usage-name">Claude</span><span className="mono">{nf.format(usage.claudeTokens)}</span></span>
          <span className="usage-item"><span className="usage-name">GPT</span><span className="mono">{nf.format(usage.gptTokens)}</span></span>
          <span className="usage-item" title="API 예비 지출 / 상한">
            <span className="usage-name">API</span>
            <span className="mono">{`$${usage.apiSpendUsd.toFixed(2)} / $${usage.apiCapUsd}`}</span>
            <span className="meter" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
          </span>
        </div>
        <a className={`attention-btn${myTurn.length > 0 ? ' is-alert' : ''}`} href="#my-turn">{`내 차례 ${myTurn.length}`}</a>
        <TelegramChip />
        <a className="btn is-primary home-new" href="#/run">+ 새 작업</a>
      </div>
    </header>
  )
}

/* ---------- 왼쪽 ---------- */

function MyTurnQueue() {
  return (
    <Panel area="turn" title="내 차례" meta={<b className="home-count">{myTurn.length}</b>}>
      <ul className="home-list" id="my-turn">
        {myTurn.map((t) => (
          <li key={t.id} className={`home-turn is-${t.kind}`}>
            <span>
              <span className="home-turn-kind">{t.kind === 'deadlock' ? '✕ ' : ''}{TURN_LABEL[t.kind]}</span>
              {t.title}
              <small>{t.detail} · {t.at}</small>
            </span>
            <a className="btn is-primary" href={t.href}>{t.kind === 'deadlock' ? '해결' : '검토'}</a>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Today() {
  const [done, setDone] = useState(() => new Set(todayTasks.filter((t) => t.done).map((t) => t.id)))
  const flip = (id: string) => setDone((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Panel area="today" title="오늘의 작업" meta={`${done.size}/${todayTasks.length} 완료`}>
      <ul className="home-list">
        {todayTasks.map((t) => (
          <li key={t.id}>
            <label className="home-check">
              <input type="checkbox" checked={done.has(t.id)} onChange={() => flip(t.id)} />
              <span className={done.has(t.id) ? 'is-done' : ''}>{t.title}</span>
              <small>{t.project} · {t.due}</small>
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Goals() {
  return (
    <Panel area="goals" title="목표" meta={`${goals.length}개`}>
      <ul className="home-list">
        {goals.map((g) => {
          const pct = g.current === null ? null : Math.min(100, Math.round((g.current / g.target) * 100))
          return (
            <li key={g.id}>
              <div className="home-row"><span>{g.title}</span><span className="mono">{pct === null ? '데이터 없음' : `${pct}%`}</span></div>
              <div className="home-bar" role="progressbar" aria-label={g.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}><i style={{ width: `${pct ?? 0}%` }} /></div>
              <small>{g.metric} {fmt(g.current)} / {nf.format(g.target)}{g.unit} · ~{g.due}</small>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function Week() {
  const max = Math.max(...week.map((d) => d.tokens), 1)
  return (
    <Panel area="week" title="주간 활동" meta={`토큰 ${nf.format(week.reduce((a, d) => a + d.tokens, 0))}`}>
      <div className="home-week">
        {week.map((d) => (
          <div key={d.label} title={`예정 ${d.planned} · 완료 ${d.done} · 실패 ${d.failed} · 토큰 ${nf.format(d.tokens)}`}>
            <div className="home-week-bar"><i style={{ height: `${(d.tokens / max) * 100}%` }} /></div>
            <span>{d.label}</span>
            <small>{d.done}/{d.planned}{d.failed > 0 && <b> ✕{d.failed}</b>}</small>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ---------- 가운데 ---------- */

function ActiveRuns() {
  return (
    <Panel area="runs" title="진행 중 실행" meta={`${activeRuns.length}개`} href="#/run">
      <ul className="home-list">
        {activeRuns.map((r) => (
          <li key={r.id} className="home-run">
            <a href="#/run" className="home-run-link">
              <span className="home-row"><strong>{r.title}</strong><small>{r.project}</small></span>
              <StageRail stage={r.stage} />
              <small>{r.note}</small>
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 } }
const CENTERS = [[330, 235], [140, 125], [140, 335], [520, 125], [520, 335], [330, 430]]

function BrainGraph({ data, selected, onSelect }: { data: BrainCluster[]; selected: string | null; onSelect: (k: string) => void }) {
  const max = Math.max(...data.map((d) => d.count))
  const nodes = useMemo(() => data.map((c, i) => {
    const [cx, cy] = CENTERS[i % CENTERS.length]
    const r = 22 + 52 * Math.sqrt(c.count / max)
    const rand = rng(i + 7)
    const dots = Array.from({ length: Math.min(c.count, 160) }, () => {
      const a = rand() * Math.PI * 2; const d = Math.sqrt(rand()) * r
      return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.8 + rand() * 1.6] as const
    })
    return { ...c, cx, cy, r, dots }
  }), [data, max])
  return (
    <svg className="home-brain-svg" viewBox="0 0 660 510" role="img" aria-label="세컨드 브레인 분류별 노트 분포">
      {nodes.map((n) => (
        <g key={n.key} role="button" tabIndex={0} aria-label={`${n.label} ${n.count}개`} aria-pressed={selected === n.key}
          className={`home-cluster${selected === n.key ? ' is-on' : ''}${selected && selected !== n.key ? ' is-dim' : ''}`}
          onClick={() => onSelect(n.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.key) } }}>
          <circle cx={n.cx} cy={n.cy} r={n.r + 6} className="home-halo" />
          {n.dots.map(([x, y, s], j) => <circle key={j} cx={x} cy={y} r={s} className="home-dot" />)}
          <text x={n.cx} y={n.cy + n.r + 18} textAnchor="middle" className="home-cluster-label">{n.label} {n.count}</text>
        </g>
      ))}
    </svg>
  )
}

/** Obsidian 연결 상태를 읽는다. 연결 전이면 목업 분류를 보여주고 그렇다고 표시한다. */
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

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

function SecondBrain() {
  const vault = useVault()
  const live = vault?.state === 'connected' ? vault : null
  // 가장 큰 분류가 가운데 오도록 많은 순으로 놓는다
  const data: BrainCluster[] = [...(live ? live.groups : brain)].sort((x, y) => y.count - x.count)
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<VaultHit[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toggle = (k: string) => setSelected((s) => (s === k ? null : k))
  const total = data.reduce((a, c) => a + c.count, 0)
  const status = live
    ? `Obsidian · ${live.readFolders.join(' + ')} · 노트 ${nf.format(total)}${live.truncated ? '+' : ''} · AI Inbox ${live.inboxCount} · ${timeOf(live.scannedAt)} 확인`
    : vault?.state === 'error' ? `Obsidian 연결 오류 · 예시 값 표시 중` : `Obsidian 연결 안 됨 · 예시 값 · 동기화 ${obsidianLastSync}`
  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    if (!live) { setErr('Obsidian이 연결되면 검색할 수 있습니다'); setHits(null); return }
    try { setErr(null); setHits(await api.vaultSearch(q.trim(), selected ?? undefined)) } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setHits(null) }
  }
  return (
    <section className="home-panel home-brain home-a-brain" aria-label="세컨드 브레인">
      <header className="home-panel-head">
        <h2>세컨드 브레인</h2>
        <span className="home-meta">{status}</span>
        <div className="seg" role="group" aria-label="보기 방식">
          <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>그래프</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>목록</button>
        </div>
      </header>
      <div className="home-brain-body">
        {data.length === 0 ? <p className="home-meta">허용 폴더에 노트가 없습니다</p>
          : view === 'graph' ? <BrainGraph data={data} selected={selected} onSelect={toggle} /> : (
          <ul className="home-list home-brain-list">
            {data.map((c) => (
              <li key={c.key}>
                <button type="button" aria-pressed={selected === c.key} className="home-brain-item" onClick={() => toggle(c.key)}>
                  <span>{c.label}</span><span className="mono">{nf.format(c.count)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form className="ask-bar home-ask" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="세컨드 브레인 검색"
          placeholder={selected ? `${data.find((b) => b.key === selected)?.label}에서 검색` : '노트 검색'} />
        <button type="submit" className="btn is-primary">검색</button>
      </form>
      {err && <p className="home-meta" role="status">{err}</p>}
      {hits && (
        <ul className="home-list home-hits" aria-label="검색 결과">
          {hits.length === 0 && <li className="home-meta">결과 없음</li>}
          {hits.map((h) => (
            <li key={h.path}>
              <a href={`obsidian://open?vault=${encodeURIComponent(live?.name ?? '')}&file=${encodeURIComponent(h.path.replace(/\.md$/, ''))}`}>
                <strong>{h.title}</strong><small>{h.path}</small><span>{h.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function QuickStarts() {
  return (
    <Panel area="quick" title="자주 쓰는 작업" meta="작업 팩으로 바로 시작">
      <div className="home-quick">
        {quickStarts.map((q) => (
          <a key={q.id} className="home-quick-card" href="#/run">
            <small>{q.pack}</small>
            <strong>{q.title}</strong>
            <span>{q.desc}</span>
          </a>
        ))}
      </div>
    </Panel>
  )
}

/* ---------- 오른쪽 ---------- */

function channelState(c: Channel) {
  if (c.status === 'connected') return <State tone="ok">{c.updatedAt} 갱신</State>
  if (c.status === 'error') return <State tone="bad">연결 오류 · 재연결</State>
  return <State tone="off">미연결</State>
}

function Channels() {
  return (
    <Panel area="channels" title="채널" meta="WordPress · YouTube · Instagram · Threads">
      <div className="home-channels">
        {channels.map((c) => (
          <div key={c.key} className={`home-channel is-${c.status}`}>
            <small>{c.label}</small>
            <strong className="mono">{fmt(c.value)}</strong>
            <small>{c.metric}{c.delta !== null && <span> ↑{nf.format(c.delta)}</span>}</small>
            {channelState(c)}
          </div>
        ))}
      </div>
    </Panel>
  )
}

function Routines() {
  return (
    <Panel area="routines" title="루틴" meta="PC가 켜져 있을 때 실행">
      <ul className="home-list">
        {routines.map((r) => (
          <li key={r.id} className="home-row">
            <span>{r.name}<small>{r.schedule}</small></span>
            <span className="home-right">
              <small>{r.nextRun}</small>
              {r.last === 'failed' ? <State tone="bad">최근 실패</State> : r.last === 'ok' ? <State tone="ok">최근 완료</State> : <State tone="off">기록 없음</State>}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Outputs() {
  return (
    <Panel area="outputs" title="최근 산출물" meta="근거와 함께">
      <ul className="home-list">
        {outputs.map((o) => (
          <li key={o.id} className="home-row">
            <span>{o.title}<small>{o.kind} · {o.evidence}</small></span>
            <small>{o.at}</small>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ---------- 화면 ---------- */

export function HomeScreen() {
  const [project, setProject] = useState('')
  return (
    <div className="home">
      <HomeTop project={project} onProject={setProject} />
      <div className="home-body">
        <nav className="home-nav" aria-label="주요 메뉴">
          {NAV.map((n) => n.href ? (
            <a key={n.label} href={n.href} aria-current={n.href === '#/' ? 'page' : undefined}>{n.label}</a>
          ) : (
            <span key={n.label} className="is-disabled" title={n.reason} aria-disabled="true">{n.label}<small>{n.reason}</small></span>
          ))}
        </nav>
        <main className="home-grid">
          <div className="home-col">
            <MyTurnQueue />
            <Today />
            <Goals />
            <Week />
          </div>
          <div className="home-col home-col-center">
            <ActiveRuns />
            <SecondBrain />
            <QuickStarts />
          </div>
          <div className="home-col">
            <Channels />
            <Routines />
            <Outputs />
          </div>
        </main>
      </div>
    </div>
  )
}
