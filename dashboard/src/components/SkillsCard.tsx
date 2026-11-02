import { useEffect, useState } from 'react'
import { api, type InstalledSkill, type SkillRun } from '../api/client'
import type { Skill } from '../model/homeMock'
import { clockHM } from '../model/time'
import { Section } from './HomeSection'
import { Markdown } from './Markdown'
import { Skeleton } from './Skeleton'
import { SkillOptionsDialog, loadOption, optionSummary, type SkillOption } from './SkillOptions'

const PER_PAGE = 4
/** 쪽 점은 이 수까지. 넘으면 이전·다음 버튼과 쪽 번호로 바꾼다(설치 스킬은 수백 개일 수 있음). */
const MAX_PAGE_DOTS = 8
const POLL_MS = 3000
export const RUN_LABEL: Record<SkillRun['status'], string> = { running: '실행 중', needs_approval: '승인 대기', done: '완료', failed: '실패', cancelled: '중단' }
const toSkill = (s: InstalledSkill): Skill => ({ id: s.name, maker: 'Claude', name: s.name, desc: s.desc, state: 'input' })
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 이 PC에 설치된 스킬. 기본은 고정(☆)한 스킬만 보이고 '전체'로 전부 본다.
 * 실행은 바로 실행 ID를 받고 3초마다 기록을 다시 읽어 상태(실행 중·승인 대기·완료…)를 보여 준다.
 */
export function SkillsCard() {
  const [skills, setSkills] = useState<Skill[] | null>(null)
  // null = 아직 못 읽음. 이때 ☆을 누르면 빈 목록 위에 저장돼 실제 고정 목록이 지워지므로 누르지 못하게 한다.
  const [pinned, setPinned] = useState<string[] | null>(null)
  const [all, setAll] = useState(false)
  const [runs, setRuns] = useState<SkillRun[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [opts, setOpts] = useState<Record<string, SkillOption>>({})
  const [err, setErr] = useState<string>()

  useEffect(() => {
    api.skills().then((list) => setSkills(list.map(toSkill))).catch((e: unknown) => { setSkills([]); setErr(errText(e)) })
    api.pinnedSkills().then(setPinned).catch((e: unknown) => setErr(`고정 목록을 읽지 못했습니다: ${errText(e)}`))
  }, [])
  useEffect(() => {
    // 루틴이 시작한 실행·승인 대기도 여기에 나타나도록 늘 다시 읽는다(로컬 서버라 가볍다).
    const load = () => { api.skillRuns().then(setRuns).catch(() => undefined) }
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [])

  const opt = (id: string) => opts[id] ?? loadOption(id)
  const active = runs.find((r) => r.status === 'running')
  const current = selected ? runs.find((r) => r.id === selected) : undefined
  const act = async (fn: () => Promise<SkillRun>) => {
    try { const r = await fn(); setSelected(r.id); setRuns((rs) => [r, ...rs.filter((x) => x.id !== r.id)]); setErr(undefined) } catch (e) { setErr(errText(e)) }
  }
  const start = (sk: Skill) => { const o = opt(sk.id); void act(() => api.runSkill({ name: sk.name, input: o.prompt, model: o.model, effort: o.effort })) }
  const togglePin = (name: string) => {
    if (!pinned) return
    const prev = pinned
    const next = pinned.includes(name) ? pinned.filter((p) => p !== name) : [...pinned, name]
    setPinned(next)
    api.setPinnedSkills(next).catch((e: unknown) => { setPinned(prev); setErr(errText(e)) })
  }
  const pins = pinned ?? []

  if (!skills) return <Section area="skills" title="스킬" meta="불러오는 중…"><Skeleton lines={3} label="스킬 불러오는 중…" /></Section>
  const base = all ? skills : skills.filter((sk) => pins.includes(sk.name))
  const shown = base.filter((sk) => `${sk.name} ${sk.desc}`.toLowerCase().includes(q.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const cur = Math.min(page, pages - 1)
  const slice = shown.slice(cur * PER_PAGE, cur * PER_PAGE + PER_PAGE)
  const target = skills.find((sk) => sk.id === editing?.id)
  const pinnedCount = skills.filter((sk) => pins.includes(sk.name)).length
  return (
    <Section area="skills" title="스킬" meta={`고정 ${pinnedCount} · 전체 ${skills.length}`}
      action={<input type="search" name="skill-q" autoComplete="off" className="hs-skill-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="스킬 검색…" aria-label="스킬 검색" />}>
      <div className="seg hs-skill-scope" role="group" aria-label="보이는 스킬">
        <button type="button" aria-pressed={!all} onClick={() => { setAll(false); setPage(0) }}>고정 {pinnedCount}</button>
        <button type="button" aria-pressed={all} onClick={() => { setAll(true); setPage(0) }}>전체 {skills.length}</button>
      </div>
      <ul className="hs-skills">
        {slice.map((sk) => {
          const isPinned = pins.includes(sk.name)
          return (
            <li key={sk.id} className="hs-skill">
              <span className="hs-skill-name">
                <strong>{sk.name}</strong>
                <button type="button" className="hs-pin" aria-pressed={isPinned} disabled={!pinned} aria-label={`${sk.name} ${isPinned ? '고정 해제' : '고정'}`} onClick={() => togglePin(sk.name)}>{isPinned ? '★' : '☆'}</button>
              </span>
              <small title={sk.desc}>{sk.desc}</small>
              <span className="hs-skill-actions">
                <button type="button" className="hs-play" disabled={!!active} onClick={() => start(sk)}>
                  <span aria-hidden="true">▶</span>{active?.skill === sk.name ? '실행 중…' : '실행'}
                </button>
                <button type="button" className="hs-opt" onClick={(e) => setEditing({ id: sk.id, anchor: e.currentTarget })} aria-expanded={editing?.id === sk.id} aria-label={`${sk.name} 옵션: ${optionSummary(opt(sk.id))}`}>
                  옵션<small>{optionSummary(opt(sk.id))}</small>
                </button>
              </span>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="hs-meta">{err && !skills.length ? `스킬 목록을 불러오지 못했습니다 (${err}). 오케스트레이터가 켜져 있는지 확인하세요.`
            : !all && !q ? '고정한 스킬이 없습니다. ‘전체’에서 ☆을 눌러 고정하세요.' : '일치하는 스킬 없음'}</li>
        )}
      </ul>
      {pages > 1 && pages <= MAX_PAGE_DOTS && (
        <div className="hs-pager" role="group" aria-label="스킬 페이지">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" aria-label={`${i + 1}쪽`} aria-current={i === cur ? 'true' : undefined} onClick={() => setPage(i)} />
          ))}
        </div>
      )}
      {pages > MAX_PAGE_DOTS && (
        <div className="hs-stepper" role="group" aria-label="스킬 페이지">
          <button type="button" className="btn" aria-label="이전 쪽" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹</button>
          <span className="mono" aria-live="polite">{cur + 1} / {pages}</span>
          <button type="button" className="btn" aria-label="다음 쪽" disabled={cur === pages - 1} onClick={() => setPage(cur + 1)}>›</button>
        </div>
      )}
      {err && skills.length > 0 && <p className="acard-error" role="alert">{err}</p>}
      {current && <RunDetail run={current} onClose={() => setSelected(null)} onAction={(a) => void act(() => api.skillRunAction(current.id, a))} />}
      {runs.length > 0 && (
        <details className="hs-run-history">
          <summary>실행 기록 {runs.length}건</summary>
          <ul className="hs-list">
            {runs.slice(0, 20).map((r) => (
              <li key={r.id}>
                <button type="button" className="hs-run-row" aria-current={r.id === current?.id ? 'true' : undefined} onClick={() => setSelected(r.id)}>
                  <span className="mono">{clockHM(new Date(r.startedAt))}</span> <strong>{r.skill}</strong>
                  {r.routine && <small> · 루틴 {r.routine}</small>} <span className={`hs-run-status is-${r.status}`}>{RUN_LABEL[r.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {target && (
        <SkillOptionsDialog skill={target} anchor={editing!.anchor} onClose={() => setEditing(null)} onSaved={(v) => setOpts((o) => ({ ...o, [target.id]: v }))} />
      )}
    </Section>
  )
}

function RunDetail({ run, onAction, onClose }: { run: SkillRun; onAction: (a: 'approve' | 'reject' | 'cancel') => void; onClose: () => void }) {
  return (
    <div className="hs-skill-result" aria-live="polite">
      <p className="hs-row">
        <span className="hs-meta">실행 · <strong>{run.skill}</strong>{run.routine ? ` · 루틴 ${run.routine}` : ''} · {clockHM(new Date(run.startedAt))}</span>
        <span className="hs-result-actions"><span className={`hs-run-status is-${run.status}`}>{RUN_LABEL[run.status]}</span><button type="button" className="btn" onClick={onClose}>닫기</button></span>
      </p>
      {run.status === 'running' && (
        <p className="hs-row"><span className="hs-meta">실행 중… 몇 분 걸릴 수 있습니다.</span><button type="button" className="btn is-danger" onClick={() => onAction('cancel')}>중단</button></p>
      )}
      {run.status === 'needs_approval' && (
        <div className="hs-approve">
          <p><strong>이 스킬이 다음 작업의 권한을 요청합니다.</strong> 승인하면 이 실행 폴더 안에서 파일 쓰기·편집만 허용해 이어서 실행합니다. 셸 명령은 승인해도 막혀 있습니다.</p>
          <ul>{(run.denied ?? []).map((d) => <li key={d} className="mono">{d}</li>)}</ul>
          <p className="hs-row">
            <button type="button" className="btn is-primary" onClick={() => onAction('approve')}>승인하고 실행</button>
            <button type="button" className="btn" onClick={() => onAction('reject')}>거절</button>
          </p>
        </div>
      )}
      {run.error && <p className="acard-error" role="alert">{run.error}</p>}
      {run.text && run.status !== 'running' && <Markdown source={run.text} />}
      {run.status === 'done' && run.denied?.length ? <p className="hs-meta">끝까지 허용되지 않은 작업: {run.denied.join(', ')}</p> : null}
      {run.files?.length ? <p className="hs-meta">만든 파일 ({`skill-runs/${run.id}/`}): {run.files.join(', ')}</p> : null}
    </div>
  )
}
