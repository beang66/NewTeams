import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { RunView } from '../api/useRun'
import { RoutinesCard } from '../components/RoutinesCard'
import { SectionIcon } from '../components/SectionIcons'
import { usageView } from '../model/usage'
import { Calendar } from './HomeScreen'

type WorkspaceKind = 'brand' | 'content' | 'ideas'
interface WorkspaceItem { id: string; title: string; type: string; note: string; status: string; createdAt: string }
interface CollectionConfig {
  title: string
  description: string
  icon: string
  noun: string
  types: string[]
  statuses: string[]
  seeds: WorkspaceItem[]
}

const now = '2026-11-02'
const item = (id: string, title: string, type: string, note: string, status: string): WorkspaceItem => ({ id, title, type, note, status, createdAt: now })
const CONFIG: Record<WorkspaceKind, CollectionConfig> = {
  brand: {
    title: '브랜드 라이브러리', description: '팀이 함께 쓰는 로고, 색상, 글꼴과 문장 원칙을 관리합니다.', icon: 'brand', noun: '브랜드 항목',
    types: ['로고', '팔레트', '글꼴', '톤 가이드'], statuses: ['사용 중', '검토 중', '보관'],
    seeds: [
      item('brand-1', 'NEWTEAM 기본 로고', '로고', '어두운 배경용 SVG와 정사각형 아이콘', '사용 중'),
      item('brand-2', '제품 기본 팔레트', '팔레트', '#000000 · #2779A7 · #FFFFFF', '사용 중'),
      item('brand-3', 'Pretendard + JetBrains Mono', '글꼴', '본문과 수치 표기에 사용하는 글꼴 조합', '사용 중'),
      item('brand-4', '짧고 근거 있는 문장', '톤 가이드', '상태와 다음 행동을 먼저 말합니다.', '검토 중'),
    ],
  },
  content: {
    title: '콘텐츠 라이브러리', description: '게시물과 제작 소스를 채널·상태별로 모아 관리합니다.', icon: 'library', noun: '콘텐츠',
    types: ['블로그', 'YouTube', 'Instagram', 'Threads', '레퍼런스'], statuses: ['초안', '검토', '예약', '게시됨'],
    seeds: [
      item('content-1', 'AI 에이전트로 1인 업무 자동화', '블로그', '2,000자 원고와 출처 6개', '검토'),
      item('content-2', '에이전트 관제 화면 소개', 'YouTube', '롱폼 #2 대본과 썸네일 문구', '초안'),
      item('content-3', '주간 작업 로그', 'Threads', '이번 주 완료·교착·다음 작업 요약', '예약'),
    ],
  },
  ideas: {
    title: '아이디어 패드', description: '떠오른 글감과 실험을 빠르게 적고, 제작 단계로 넘깁니다.', icon: 'ideas', noun: '아이디어',
    types: ['글감', '영상', '기능', '실험'], statuses: ['수집', '발전 중', '채택', '보류'],
    seeds: [
      item('idea-1', '에이전트가 멈춘 이유를 한눈에', '기능', '교착 원인과 사람이 할 일을 한 문장으로 표시', '채택'),
      item('idea-2', '하루 토큰 사용 회고', '글감', '작업량과 비용을 함께 보는 짧은 회고', '발전 중'),
      item('idea-3', '한 원고를 세 채널로 변환', '실험', '블로그 원고를 영상·Threads 포맷으로 비교', '수집'),
    ],
  },
}

function useStoredList<T>(key: string, initial: T[]): [T[], (next: T[]) => void] {
  const [value, setValue] = useState<T[]>(() => {
    try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T[] : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ } }, [key, value])
  return [value, setValue]
}

function WorkspaceHeader({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <header className="ws-head">
      <a href="#/" className="ws-back" aria-label="홈으로">홈</a>
      <span className="ws-head-icon" aria-hidden="true"><SectionIcon name={icon} size={24} /></span>
      <span><h1>{title}</h1><p>{description}</p></span>
      <nav aria-label="다른 대시보드">
        <a href="#/brand">브랜드</a><a href="#/content">콘텐츠</a><a href="#/ideas">아이디어</a><a href="#/calendar">캘린더</a><a href="#/settings">설정</a>
      </nav>
    </header>
  )
}

function AssetPreview({ kind, entry }: { kind: WorkspaceKind; entry: WorkspaceItem }) {
  if (kind === 'brand' && entry.type === '팔레트') {
    return <div className="ws-preview is-palette" aria-label={entry.note}><span /><span /><span /></div>
  }
  if (kind === 'brand' && entry.type === '글꼴') {
    return <div className="ws-preview is-type" aria-label="글꼴 미리보기"><strong>Aa</strong><span>가나다 0123</span></div>
  }
  if (kind === 'brand' && entry.type === '로고') {
    return <div className="ws-preview is-logo" aria-label="로고 미리보기"><strong>NEWTEAM</strong><span>AGENT STUDIO</span></div>
  }
  if (kind === 'content') {
    return <div className="ws-preview is-content" aria-label={`${entry.type} 미리보기`}><span>{entry.type}</span><strong>{entry.title}</strong><small>{entry.note}</small></div>
  }
  if (kind === 'ideas') {
    return <div className="ws-preview is-idea" aria-label="아이디어 미리보기"><strong>{entry.title}</strong><span>{entry.note}</span></div>
  }
  return <div className="ws-preview is-copy" aria-label="문장 미리보기"><span>“</span><strong>{entry.note}</strong></div>
}

function CollectionScreen({ kind }: { kind: WorkspaceKind }) {
  const c = CONFIG[kind]
  const [items, setItems] = useStoredList(`newteams.workspace.${kind}`, c.seeds)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('전체')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ title: '', type: c.types[0]!, note: '', status: c.statuses[0]! })
  useEffect(() => {
    // 이전 라우트 상태가 다른 라이브러리에 기록된 구버전 데이터를 한 번 복구한다.
    if (items.some((entry) => !c.types.includes(entry.type))) setItems(c.seeds)
  }, [c.seeds, c.types, items, setItems])
  const visible = useMemo(() => items.filter((x) => (category === '전체' || x.type === category) && `${x.title} ${x.type} ${x.note} ${x.status}`.toLowerCase().includes(q.trim().toLowerCase())), [category, items, q])
  const counts = useMemo(() => new Map(c.types.map((type) => [type, items.filter((x) => x.type === type).length])), [c.types, items])
  const save = (e: FormEvent) => {
    e.preventDefault()
    const title = draft.title.trim()
    if (!title) return
    const next = { ...draft, title, note: draft.note.trim() }
    setItems(editing
      ? items.map((x) => x.id === editing ? { ...x, ...next } : x)
      : [{ ...next, id: `${kind}-${Date.now()}`, createdAt: new Date().toISOString().slice(0, 10) }, ...items])
    closeEditor()
  }
  const closeEditor = () => { setDraft({ title: '', type: c.types[0]!, note: '', status: c.statuses[0]! }); setAdding(false); setEditing(null) }
  const edit = (entry: WorkspaceItem) => { setDraft({ title: entry.title, type: entry.type, note: entry.note, status: entry.status }); setEditing(entry.id); setAdding(true) }
  const remove = (x: WorkspaceItem) => {
    if (window.confirm(`‘${x.title}’을(를) 삭제할까요?`)) setItems(items.filter((i) => i.id !== x.id))
  }
  return (
    <div className="workspace">
      <WorkspaceHeader title={c.title} description={c.description} icon={c.icon} />
      <main className="ws-library">
        <aside className="ws-library-side" aria-label={`${c.title} 분류`}>
          <h2>분류</h2>
          <button type="button" aria-current={category === '전체' ? 'true' : undefined} onClick={() => setCategory('전체')}><span>전체</span><span className="mono">{items.length}</span></button>
          {c.types.map((type) => <button key={type} type="button" aria-current={category === type ? 'true' : undefined} onClick={() => setCategory(type)}><span>{type}</span><span className="mono">{counts.get(type)}</span></button>)}
          <div className="ws-library-source"><strong>저장 위치</strong><span>이 브라우저</span><small>볼트 연결 방식 검토 중</small></div>
        </aside>
        <section className="ws-library-main" aria-labelledby="library-title">
          <div className="ws-toolbar">
            <label><span className="sr-only">{c.title} 검색</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 설명 · 상태 검색" /></label>
            <span className="ws-count mono">{visible.length} / {items.length}</span>
            <button type="button" className="btn is-primary" onClick={() => { closeEditor(); setAdding(true) }}>+ {c.noun}</button>
          </div>
          <div className="ws-library-title"><h2 id="library-title">{category === '전체' ? `전체 ${c.noun}` : category}</h2><span className="mono">{visible.length}</span></div>
          {adding && (
          <form className="ws-create" onSubmit={save}>
            <label className="field"><span className="field-label">이름</span><input autoFocus required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="field"><span className="field-label">종류</span><select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{c.types.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field"><span className="field-label">상태</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{c.statuses.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field ws-note"><span className="field-label">설명</span><textarea rows={2} maxLength={500} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
            <span className="ws-form-actions"><button className="btn is-primary" type="submit">{editing ? '수정 저장' : '저장'}</button><button className="btn" type="button" onClick={closeEditor}>취소</button></span>
          </form>
          )}
        <div className="ws-asset-grid" role="list" aria-label={c.title}>
          {visible.map((x) => (
            <article key={x.id} className="ws-asset" role="listitem">
              <AssetPreview kind={kind} entry={x} />
              <div className="ws-asset-meta"><span className="ws-status">{x.status}</span><span className="ws-kind">{x.type}</span></div>
              <strong className="ws-asset-title">{x.title}</strong>
              <small>{x.note || '설명 없음'}</small>
              <div className="ws-asset-foot"><time className="mono" dateTime={x.createdAt}>{x.createdAt.replaceAll('-', '.')}</time><span><button type="button" className="btn" onClick={() => edit(x)}>수정</button><button type="button" className="btn is-danger" onClick={() => remove(x)}>삭제</button></span></div>
            </article>
          ))}
          {visible.length === 0 && <p className="ws-empty">일치하는 항목이 없습니다. 검색어를 바꾸거나 새 항목을 추가하세요.</p>}
        </div>
        </section>
      </main>
    </div>
  )
}

interface CalendarEntry { id: string; title: string; due: string; channel: string }
const calendarSeeds: CalendarEntry[] = [
  { id: 'schedule-1', title: 'WordPress 소개 페이지 공개', due: '2026-11-04T10:00', channel: 'WordPress' },
  { id: 'schedule-2', title: '주간 작업 로그', due: '2026-11-06T18:00', channel: 'Threads' },
]

function CalendarWorkspace({ run }: { run: RunView }) {
  const usage = usageView(run.events, run.state, run.agents, new Date())
  const [entries, setEntries] = useStoredList('newteams.workspace.calendar', calendarSeeds)
  const [draft, setDraft] = useState({ title: '', due: '', channel: 'WordPress' })
  const add = (e: FormEvent) => {
    e.preventDefault(); if (!draft.title.trim() || !draft.due) return
    setEntries([...entries, { ...draft, title: draft.title.trim(), id: `schedule-${Date.now()}` }].sort((a, b) => a.due.localeCompare(b.due)))
    setDraft({ title: '', due: '', channel: 'WordPress' })
  }
  return (
    <div className="workspace">
      <WorkspaceHeader title="콘텐츠·캘린더" description="게시 일정과 에이전트 실행량을 같은 날짜에서 확인합니다." icon="calendar" />
      <main className="ws-main ws-calendar-grid">
        <Calendar usage={usage} />
        <section className="ws-schedule" aria-labelledby="schedule-title">
          <h2 id="schedule-title">게시 일정</h2>
          <form className="ws-schedule-form" onSubmit={add}>
            <input required maxLength={120} aria-label="일정 이름" placeholder="게시할 콘텐츠…" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <select aria-label="채널" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}><option>WordPress</option><option>YouTube</option><option>Instagram</option><option>Threads</option></select>
            <input required type="datetime-local" aria-label="게시 시각" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
            <button className="btn is-primary" type="submit">일정 추가</button>
          </form>
          <ol className="ws-timeline">
            {entries.map((x) => <li key={x.id}><time className="mono" dateTime={x.due}>{new Date(x.due).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</time><span><strong>{x.title}</strong><small>{x.channel}</small></span><button type="button" className="btn is-danger" onClick={() => setEntries(entries.filter((e) => e.id !== x.id))}>삭제</button></li>)}
          </ol>
        </section>
      </main>
    </div>
  )
}

const PACKS = [
  { id: 'content', name: '콘텐츠 제작', detail: '리서치 → 초안 → 채널 변환 → 검수' },
  { id: 'webapp', name: '웹앱 개발', detail: '스펙 → 개발·QA → 완료 보고' },
  { id: 'research', name: '리서치 보고서', detail: '자료 수집 → 출처 검증 → 보고서' },
]

function SettingsWorkspace() {
  const [enabled, setEnabled] = useStoredList('newteams.workspace.packs', ['content', 'webapp'])
  const toggle = (id: string) => setEnabled(enabled.includes(id) ? enabled.filter((x) => x !== id) : [...enabled, id])
  return (
    <div className="workspace">
      <WorkspaceHeader title="작업 팩·루틴·설정" description="반복 작업의 기본 흐름과 예약 실행을 한곳에서 관리합니다." icon="settings" />
      <main className="ws-main ws-settings-grid">
        <section className="ws-packs" aria-labelledby="packs-title">
          <h2 id="packs-title">작업 팩</h2>
          <p>새 작업을 시작할 때 불러올 기본 단계 묶음입니다.</p>
          <ul>{PACKS.map((p) => <li key={p.id}><label><input type="checkbox" checked={enabled.includes(p.id)} onChange={() => toggle(p.id)} /><span><strong>{p.name}</strong><small>{p.detail}</small></span></label></li>)}</ul>
          <p className="ws-saved" role="status">이 브라우저에 자동 저장됩니다.</p>
        </section>
        <RoutinesCard />
        <section className="ws-connections" aria-labelledby="connections-title">
          <h2 id="connections-title">연결 설정</h2>
          <dl><div><dt>오케스트레이터</dt><dd>로컬 서버 · 127.0.0.1:4317</dd></div><div><dt>Claude / GPT</dt><dd>에이전트 역할 설정을 따름</dd></div><div><dt>Telegram</dt><dd>헤더 설정에서 연결 상태 확인</dd></div></dl>
          <a className="btn" href="#/run">에이전트 관제로 이동</a>
        </section>
      </main>
    </div>
  )
}

export function WorkspaceScreen({ path, run }: { path: string; run: RunView }) {
  if (path.startsWith('/calendar')) return <CalendarWorkspace run={run} />
  if (path.startsWith('/settings')) return <SettingsWorkspace />
  const kind: WorkspaceKind = path.startsWith('/content') ? 'content' : path.startsWith('/ideas') ? 'ideas' : 'brand'
  return <CollectionScreen key={kind} kind={kind} />
}
