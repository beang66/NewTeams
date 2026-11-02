import { useEffect, useState } from 'react'
import type { RunView } from '../api/useRun'
import { api } from '../api/client'
import { AskBar } from '../components/AskBar'
import { DoneAside } from '../components/DoneAside'
import { DoneFigure } from '../components/DoneFigure'
import { Markdown } from '../components/Markdown'
import { Skeleton } from '../components/Skeleton'
import { TopBar } from '../components/TopBar'
import { doneStats } from '../model/doneStats'
import { ControlScreen } from './ControlScreen'

type Report = { state: 'loading' } | { state: 'ready'; text: string | null }

/** Saves report.md exactly as served (no prompts) through a temporary download link. */
export function downloadMarkdown(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'report.md'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function DoneScreen({ run }: { run: RunView }) {
  const [report, setReport] = useState<Report>({ state: 'loading' })
  const [control, setControl] = useState(false)
  const [rawTarget, setRawTarget] = useState<string | undefined>()
  useEffect(() => {
    let live = true
    api.human('report.md').catch(() => null).then((text) => { if (live) setReport({ state: 'ready', text }) })
    return () => { live = false }
  }, [])

  const toggle = (
    <>
      <span className="chip is-ok">완료</span>
      <button type="button" className="btn" onClick={() => { setRawTarget(undefined); setControl((v) => !v) }}>{control ? '보고서 보기' : '관제 화면 보기'}</button>
    </>
  )
  if (control) return <ControlScreen key={rawTarget ?? 'control'} run={run} initialRawEvent={rawTarget} topBarExtra={toggle} />

  const s = doneStats(run.events, run.state)
  const text = report.state === 'ready' ? report.text : null
  const jump = (id: string) => { setRawTarget(id); setControl(true) }
  return (
    <div className="control done">
      <TopBar run={run} extra={toggle} />
      <main className="paper done-paper">
        <article className="done-article">
          <header className="done-head">
            <p className="by">{`최종 평가 · report.md${s.firstId && s.lastId ? ` · 원본 ${s.firstId} ~ ${s.lastId}` : ''}`}</p>
            <button type="button" className="btn paper-btn" disabled={text === null} onClick={() => text !== null && downloadMarkdown(text)}>Markdown 내려받기</button>
          </header>
          <DoneFigure run={run} />
          {report.state === 'loading' ? <Skeleton lines={5} label="보고서 불러오는 중…" />
            : text === null ? <p className="paper-empty">report.md가 아직 없습니다.</p> : <Markdown source={text} onRawLink={jump} />}
        </article>
        <DoneAside run={run} />
      </main>
      <AskBar events={run.events} onRawLink={jump} />
    </div>
  )
}
