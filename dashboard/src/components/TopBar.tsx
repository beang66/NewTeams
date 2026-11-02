import { useEffect, useState, type ReactNode } from 'react'
import { api, type ProjectInfo } from '../api/client'
import type { RunView } from '../api/useRun'
import { attentionItems } from '../model/attention'
import { StageRail } from './StageRail'
import { TelegramChip } from './TelegramChip'
import { PipelineControl } from './PipelineControl'

interface Props { run: RunView; onOpenAttention?: () => void; now?: () => Date; hasSpecDraft?: boolean; extra?: ReactNode; view?: 'control' | 'overview'; onView?: (v: 'control' | 'overview') => void }

export function TopBar({ run, onOpenAttention, hasSpecDraft = false, extra, view = 'control', onView }: Props) {
  const count = attentionItems(run.state, run.events, { hasSpecDraft }).length
  return (
    <header className="topbar">
      <div className="topbar-title"><a href="#/" className="topbar-home" aria-label="홈으로">←</a><ProjectName /></div>
      <StageRail stage={run.state.stage} />
      {onView && (
        <div className="seg" role="group" aria-label="화면 전환">
          <button type="button" aria-pressed={view === 'control'} onClick={() => onView('control')}>관제</button>
          <button type="button" aria-pressed={view === 'overview'} onClick={() => onView('overview')}>개요</button>
        </div>
      )}
      <div className="topbar-right">
        {extra}
        <PipelineControl state={run.state} />
        <button type="button" className={`attention-btn${count > 0 ? ' is-alert' : ''}`} onClick={onOpenAttention}>{`주의 ${count}`}</button>
        <TelegramChip />
        {!run.connected && <span className="chip is-warn">연결 끊김 — 다시 연결 중</span>}
      </div>
    </header>
  )
}

/** 지금 관제 화면의 프로젝트(표시 이름). 주소의 프로젝트 이름(폴더)과 따로 바꿀 수 있다. */
export function useProjectName(): string | undefined {
  return useProjectInfo()[0]?.displayName
}
function useProjectInfo(): [ProjectInfo | undefined, (p: ProjectInfo) => void] {
  const [info, setInfo] = useState<ProjectInfo>()
  useEffect(() => {
    const on = (e: Event) => setInfo((e as CustomEvent<ProjectInfo>).detail)
    window.addEventListener('project-renamed', on)
    api.project().then(setInfo).catch(() => undefined)
    return () => window.removeEventListener('project-renamed', on)
  }, [])
  // 이름을 바꾸면 같은 화면의 다른 곳(사용량 묶음 등)도 바로 따라 바뀌게 알린다.
  return [info, (p) => window.dispatchEvent(new CustomEvent('project-renamed', { detail: p }))]
}

/** 헤더의 프로젝트 이름. 누르면 그 자리에서 고친다(Enter 저장, Esc 취소). */
function ProjectName() {
  const [info, announce] = useProjectInfo()
  const [draft, setDraft] = useState<string | null>(null)
  const [err, setErr] = useState<string>()
  if (!info) return <h1 className="topbar-project">관제</h1>
  const save = async () => {
    const next = (draft ?? '').trim()
    if (!next || next === info.displayName) { setDraft(null); return }
    try { announce(await api.renameProject(next)); setDraft(null); setErr(undefined) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  if (draft !== null) {
    return (
      <span className="topbar-rename">
        <input autoFocus aria-label="프로젝트 이름" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); if (e.key === 'Escape') setDraft(null) }}
          onBlur={() => void save()} />
        {err && <span className="acard-error" role="alert">{err}</span>}
      </span>
    )
  }
  return (
    <h1 className="topbar-project">
      <button type="button" className="topbar-project-btn" onClick={() => setDraft(info.displayName)} title={`주소: #/run/${info.name} · 눌러서 이름 바꾸기`}>
        {info.displayName}<span className="topbar-edit" aria-hidden="true">✎</span><span className="sr-only"> 이름 바꾸기</span>
      </button>
    </h1>
  )
}
