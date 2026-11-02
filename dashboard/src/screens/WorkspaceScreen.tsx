import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, type LibraryInput, type LibraryItem, type LibraryKind, type SkillRun } from '../api/client'
import type { RunView } from '../api/useRun'
import { Markdown } from '../components/Markdown'
import { RoutinesCard } from '../components/RoutinesCard'
import { SectionIcon } from '../components/SectionIcons'
import { usageView } from '../model/usage'
import { Calendar } from './HomeScreen'

type WorkspaceKind = LibraryKind
interface CollectionConfig {
  title: string
  description: string
  icon: string
  noun: string
  types: string[]
  statuses: string[]
}

const CONFIG: Record<WorkspaceKind, CollectionConfig> = {
  brand: {
    title: '브랜드 라이브러리', description: '팀이 함께 쓰는 로고, 색상, 글꼴과 문장 원칙을 관리합니다.', icon: 'brand', noun: '브랜드 항목',
    types: ['로고', '팔레트', '글꼴', '톤 가이드'], statuses: ['사용 중', '검토 중', '보관'],
  },
  content: {
    title: '콘텐츠 라이브러리', description: '게시물과 제작 소스를 채널·상태별로 모아 관리합니다.', icon: 'library', noun: '콘텐츠',
    types: ['블로그', 'YouTube', 'Instagram', 'Threads', 'X', '레퍼런스'], statuses: ['초안', '검토', '예약', '게시됨'],
  },
  ideas: {
    title: '아이디어 패드', description: '떠오른 글감과 실험을 빠르게 적고, 제작 단계로 넘깁니다.', icon: 'ideas', noun: '아이디어',
    types: ['글감', '영상', '기능', '실험'], statuses: ['수집', '발전 중', '채택', '보류'],
  },
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const excerpt = (body: string) => body.replace(/^#+\s.*$/m, '').replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
const itemHref = (kind: WorkspaceKind, file: string) => `#/${kind}/${encodeURIComponent(file)}`

function useStoredList<T>(key: string, initial: T[]): [T[], (next: T[]) => void] {
  const [value, setValue] = useState<T[]>(() => {
    try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T[] : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ } }, [key, value])
  return [value, setValue]
}

/** 예전에 이 브라우저(localStorage)에 저장한 항목을 Vault로 한 번 옮긴다. 모두 옮겨지면 브라우저 사본을 지운다. */
export async function migrateLocal(kind: WorkspaceKind): Promise<void> {
  const key = `newteams.workspace.${kind}`
  let saved: unknown
  try { saved = JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return }
  if (!Array.isArray(saved)) return
  for (const x of saved as { title?: string; type?: string; note?: string; status?: string }[]) {
    if (!x.title?.trim()) continue
    try {
      await api.createLibraryItem(kind, { title: x.title, kind: x.type ?? '', status: x.status ?? '', tags: [], body: x.note ?? '' })
    } catch (e) { if (!(e instanceof ApiError && e.status === 409)) throw e }
  }
  localStorage.removeItem(key)
}

const NAV = [
  { path: '/', label: '홈' }, { path: '/brand', label: '브랜드 라이브러리' }, { path: '/content', label: '콘텐츠 라이브러리' },
  { path: '/ideas', label: '아이디어 패드' }, { path: '/calendar', label: '콘텐츠·캘린더' }, { path: '/settings', label: '작업 팩·루틴·설정' },
]

function WorkspaceNav({ current }: { current: string }) {
  return (
    <nav className="ws-nav" aria-label="다른 대시보드">
      <h2>다른 대시보드</h2>
      {NAV.map((n) => <a key={n.path} href={`#${n.path}`} aria-current={n.path === current ? 'page' : undefined}>{n.label}</a>)}
    </nav>
  )
}

function WorkspaceHeader({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <header className="ws-head">
      <a href="#/" className="ws-back" aria-label="홈으로">홈</a>
      <span className="ws-head-icon" aria-hidden="true"><SectionIcon name={icon} size={24} /></span>
      <span><h1>{title}</h1><p>{description}</p></span>
    </header>
  )
}

/** 왼쪽 사이드바(분류·저장 위치 + 다른 대시보드 탭)와 본문 2열. */
function WorkspaceLayout({ current, side, children }: { current: string; side?: ReactNode; children: ReactNode }) {
  return (
    <div className="ws-library">
      <aside className="ws-library-side">{side}<WorkspaceNav current={current} /></aside>
      <div className="ws-library-main">{children}</div>
    </div>
  )
}

function AssetPreview({ kind, entry }: { kind: WorkspaceKind; entry: LibraryItem }) {
  const note = excerpt(entry.body)
  if (kind === 'brand' && entry.kind === '팔레트') {
    return <div className="ws-preview is-palette" aria-label={note}><span /><span /><span /></div>
  }
  if (kind === 'brand' && entry.kind === '글꼴') {
    return <div className="ws-preview is-type" aria-label="글꼴 미리보기"><strong>Aa</strong><span>가나다 0123</span></div>
  }
  if (kind === 'brand' && entry.kind === '로고') {
    return <div className="ws-preview is-logo" aria-label="로고 미리보기"><strong>NEWTEAM</strong><span>AGENT STUDIO</span></div>
  }
  if (kind === 'content') {
    return <div className="ws-preview is-content" aria-label={`${entry.kind} 미리보기`}><span>{entry.kind}</span><strong>{entry.title}</strong><small>{note}</small></div>
  }
  if (kind === 'ideas') {
    return <div className="ws-preview is-idea" aria-label="아이디어 미리보기"><strong>{entry.title}</strong><span>{note}</span></div>
  }
  return <div className="ws-preview is-copy" aria-label="문장 미리보기"><span>“</span><strong>{note || entry.title}</strong></div>
}

function StorageBox({ kind, err }: { kind: WorkspaceKind; err?: string }) {
  return (
    <div className="ws-library-source">
      <strong>저장 위치</strong>
      {err ? <><span>Vault에 연결되지 않음</span><small>오케스트레이터와 Vault 설정을 확인하세요.</small></>
        : <><span className="mono">Vault/Libraries/{kind}</span><small>Obsidian에서도 같은 노트가 열립니다.</small></>}
    </div>
  )
}

function CollectionScreen({ kind }: { kind: WorkspaceKind }) {
  const c = CONFIG[kind]
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [err, setErr] = useState<string>()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('전체')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', kind: c.types[0]!, body: '', status: c.statuses[0]! })
  const load = () => api.library(kind).then((list) => { setItems(list); setErr(undefined) }).catch((e: unknown) => { setItems([]); setErr(errText(e)) })
  useEffect(() => { void migrateLocal(kind).catch(() => undefined).finally(() => { void load() }) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => items ?? [], [items])
  const visible = useMemo(() => list.filter((x) => (category === '전체' || x.kind === category) && `${x.title} ${x.kind} ${x.body} ${x.status} ${x.tags.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())), [category, list, q])
  const counts = useMemo(() => new Map(c.types.map((type) => [type, list.filter((x) => x.kind === type).length])), [c.types, list])
  const closeEditor = () => { setDraft({ title: '', kind: c.types[0]!, body: '', status: c.statuses[0]! }); setAdding(false) }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const title = draft.title.trim()
    if (!title) return
    try { await api.createLibraryItem(kind, { ...draft, title, tags: [] }); closeEditor(); await load() } catch (e) { setErr(errText(e)) }
  }
  const side = (
    <>
      <h2>분류</h2>
      <button type="button" aria-current={category === '전체' ? 'true' : undefined} onClick={() => setCategory('전체')}><span>전체</span><span className="mono">{list.length}</span></button>
      {c.types.map((type) => <button key={type} type="button" aria-current={category === type ? 'true' : undefined} onClick={() => setCategory(type)}><span>{type}</span><span className="mono">{counts.get(type)}</span></button>)}
      <StorageBox kind={kind} err={items && err && !list.length ? err : undefined} />
    </>
  )
  return (
    <div className="workspace">
      <WorkspaceHeader title={c.title} description={c.description} icon={c.icon} />
      <WorkspaceLayout current={`/${kind}`} side={side}>
        <section aria-labelledby="library-title">
          <div className="ws-toolbar">
            <label><span className="sr-only">{c.title} 검색</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 내용 · 상태 · 태그 검색" /></label>
            <span className="ws-count mono">{visible.length} / {list.length}</span>
            <button type="button" className="btn is-primary" onClick={() => { closeEditor(); setAdding(true) }}>+ {c.noun}</button>
          </div>
          <div className="ws-library-title"><h2 id="library-title">{category === '전체' ? `전체 ${c.noun}` : category}</h2><span className="mono">{visible.length}</span></div>
          {err && <p className="acard-error" role="alert">{err}</p>}
          {adding && (
            <form className="ws-create" onSubmit={(e) => void save(e)}>
              <label className="field"><span className="field-label">이름</span><input autoFocus required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
              <label className="field"><span className="field-label">종류</span><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{c.types.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field"><span className="field-label">상태</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{c.statuses.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field ws-note"><span className="field-label">내용</span><textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
              <span className="ws-form-actions"><button className="btn is-primary" type="submit">저장</button><button className="btn" type="button" onClick={closeEditor}>취소</button></span>
            </form>
          )}
          <div className="ws-asset-grid" role="list" aria-label={c.title}>
            {visible.map((x) => (
              <a key={x.file} className="ws-asset" role="listitem" href={itemHref(kind, x.file)} aria-label={`${x.title} 열기`}>
                <AssetPreview kind={kind} entry={x} />
                <div className="ws-asset-meta"><span className="ws-status">{x.status || '상태 없음'}</span><span className="ws-kind">{x.kind}</span></div>
                <strong className="ws-asset-title">{x.title}</strong>
                <small>{excerpt(x.body) || '내용 없음'}</small>
                <div className="ws-asset-foot"><time className="mono" dateTime={x.updated}>{x.updated.slice(0, 10).replaceAll('-', '.')}</time></div>
              </a>
            ))}
            {items && visible.length === 0 && <p className="ws-empty">{list.length ? '일치하는 항목이 없습니다. 검색어를 바꾸세요.' : `아직 항목이 없습니다. ‘+ ${c.noun}’으로 추가하세요.`}</p>}
          </div>
        </section>
      </WorkspaceLayout>
    </div>
  )
}

/** 카드 하나의 전체 내용 페이지: 읽기, 고치기, 삭제. */
function ItemScreen({ kind, file }: { kind: WorkspaceKind; file: string }) {
  const c = CONFIG[kind]
  const [item, setItem] = useState<LibraryItem | null>(null)
  const [err, setErr] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [draft, setDraft] = useState<(LibraryInput & { tagText: string }) | null>(null)
  const load = () => api.libraryItem(kind, file).then((x) => { setItem(x); setErr(undefined); setConflict(false) }).catch((e: unknown) => setErr(errText(e)))
  useEffect(() => { void load() }, [kind, file]) // eslint-disable-line react-hooks/exhaustive-deps
  const startEdit = (x: LibraryItem) => setDraft({ title: x.title, kind: x.kind, status: x.status, tags: x.tags, body: x.body, tagText: x.tags.join(', ') })
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!item || !draft || !draft.title.trim()) return
    const { tagText, ...rest } = draft
    try {
      setItem(await api.updateLibraryItem(kind, file, { ...rest, title: rest.title.trim(), tags: tagText.split(',').map((t) => t.trim()).filter(Boolean), mtimeMs: item.mtimeMs }))
      setDraft(null); setErr(undefined)
    } catch (e) {
      setConflict(e instanceof ApiError && e.status === 409)
      setErr(errText(e))
    }
  }
  const remove = async () => {
    if (!item || !window.confirm(`‘${item.title}’을(를) 삭제할까요? Vault의 Libraries/.trash로 옮겨집니다.`)) return
    try { await api.deleteLibraryItem(kind, file); window.location.hash = `#/${kind}` } catch (e) { setErr(errText(e)) }
  }
  const options = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list)
  const side = (
    <>
      <a className="ws-side-back" href={`#/${kind}`}>← {c.title}</a>
      <StorageBox kind={kind} />
    </>
  )
  return (
    <div className="workspace">
      <WorkspaceHeader title={c.title} description={c.description} icon={c.icon} />
      <WorkspaceLayout current={`/${kind}`} side={side}>
        <article className="ws-detail">
          {err && (
            <p className="acard-error" role="alert">{err}{conflict && <> <button type="button" className="btn" onClick={() => { setDraft(null); void load() }}>다시 불러오기</button></>}</p>
          )}
          {!item && !err && <p className="ws-empty">불러오는 중…</p>}
          {item && !draft && (
            <>
              <div className="ws-detail-head">
                <h2>{item.title}</h2>
                <span className="ws-detail-actions">
                  <button type="button" className="btn is-primary" onClick={() => startEdit(item)}>수정</button>
                  <button type="button" className="btn is-danger" onClick={() => void remove()}>삭제</button>
                </span>
              </div>
              <div className="ws-asset-meta">
                <span className="ws-status">{item.status || '상태 없음'}</span><span className="ws-kind">{item.kind}</span>
                {item.tags.map((t) => <span key={t} className="ws-tag">#{t}</span>)}
                <time className="mono" dateTime={item.updated}>{item.updated.slice(0, 16).replace('T', ' ')}</time>
              </div>
              <div className="ws-detail-body">{item.body ? <Markdown source={item.body} /> : <p className="ws-empty">내용 없음</p>}</div>
              <p className="ws-detail-file mono">Libraries/{kind}/{item.file}</p>
            </>
          )}
          {item && draft && (
            <form className="ws-create ws-edit" onSubmit={(e) => void save(e)} aria-label={`${item.title} 수정`}>
              <label className="field"><span className="field-label">이름</span><input required maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
              <label className="field"><span className="field-label">종류</span><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{options(c.types, draft.kind).map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field"><span className="field-label">상태</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{options(c.statuses, draft.status).map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field ws-note"><span className="field-label">태그(쉼표로 구분)</span><input value={draft.tagText} onChange={(e) => setDraft({ ...draft, tagText: e.target.value })} /></label>
              <label className="field ws-note"><span className="field-label">내용(Markdown)</span><textarea rows={18} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
              <span className="ws-form-actions"><button className="btn is-primary" type="submit">저장</button><button className="btn" type="button" onClick={() => { setDraft(null); setErr(undefined) }}>취소</button></span>
            </form>
          )}
        </article>
      </WorkspaceLayout>
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
      <WorkspaceLayout current="/calendar">
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
      </WorkspaceLayout>
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
      <WorkspaceLayout current="/settings">
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
      </WorkspaceLayout>
    </div>
  )
}

const RUN_LABEL: Record<SkillRun['status'], string> = { running: '실행 중', needs_approval: '승인 대기', done: '완료', failed: '실패', cancelled: '중단' }
const runTime = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** 최근 산출물 하나(스킬 실행 결과)의 상세 페이지. */
function OutputScreen({ id }: { id: string }) {
  const [run, setRun] = useState<SkillRun | null>(null)
  const [err, setErr] = useState<string>()
  useEffect(() => {
    api.skillRuns().then((list) => { const r = list.find((x) => x.id === id); if (r) setRun(r); else setErr('실행 기록을 찾을 수 없습니다.') })
      .catch((e: unknown) => setErr(errText(e)))
  }, [id])
  return (
    <div className="workspace">
      <WorkspaceHeader title="최근 산출물" description="스킬과 루틴이 만든 결과를 읽습니다." icon="outputs" />
      <WorkspaceLayout current="" side={<a className="ws-side-back" href="#/">← 홈</a>}>
        <article className="ws-detail">
          {err && <p className="acard-error" role="alert">{err}</p>}
          {!run && !err && <p className="ws-empty">불러오는 중…</p>}
          {run && (
            <>
              <div className="ws-detail-head"><h2>{run.input.split('\n')[0]?.slice(0, 80) || run.skill}</h2></div>
              <div className="ws-asset-meta">
                <span className="ws-status">{RUN_LABEL[run.status]}</span><span className="ws-kind">{run.skill}</span>
                {run.routine && <span className="ws-tag">루틴 {run.routine}</span>}
                <span className="ws-tag">{run.model} · {run.effort}</span>
                <time className="mono" dateTime={run.endedAt ?? run.startedAt}>{runTime.format(new Date(run.endedAt ?? run.startedAt))}</time>
              </div>
              <details className="ws-detail-input"><summary>입력(프롬프트)</summary><pre>{run.input || '(없음)'}</pre></details>
              <div className="ws-detail-body">{run.text ? <Markdown source={run.text} /> : <p className="ws-empty">결과 텍스트 없음</p>}</div>
              {run.error && <p className="acard-error">{run.error}</p>}
              {run.files?.length ? <p className="ws-detail-file mono">만든 파일 (skill-runs/{run.id}/): {run.files.join(', ')}</p> : null}
              {run.denied?.length ? <p className="ws-detail-file">허용되지 않은 작업: {run.denied.join(', ')}</p> : null}
            </>
          )}
        </article>
      </WorkspaceLayout>
    </div>
  )
}

export function WorkspaceScreen({ path, run }: { path: string; run: RunView }) {
  if (path.startsWith('/outputs/')) {
    let id = path.slice('/outputs/'.length)
    try { id = decodeURIComponent(id) } catch { /* 그대로 */ }
    return <OutputScreen key={id} id={id} />
  }
  if (path.startsWith('/calendar')) return <CalendarWorkspace run={run} />
  if (path.startsWith('/settings')) return <SettingsWorkspace />
  const [, first = 'brand', rest] = /^\/(brand|content|ideas)(?:\/([^?]+))?/.exec(path) ?? []
  const kind = first as WorkspaceKind
  if (rest) {
    let file = rest
    try { file = decodeURIComponent(rest) } catch { /* 그대로 */ }
    return <ItemScreen key={`${kind}/${file}`} kind={kind} file={file} />
  }
  return <CollectionScreen key={kind} kind={kind} />
}
