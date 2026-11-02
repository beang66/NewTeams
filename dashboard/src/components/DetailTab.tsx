import { useEffect, useState } from 'react'
import type { Envelope } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'
import { api } from '../api/client'
import { Markdown } from './Markdown'

export type DetailSub = 'human' | 'raw'
export interface Selection { eventId?: string; taskId?: string }

interface Loaded<T> { key: string; value: T }

/** Quiet loader: missing files and request failures both resolve to null (never an error banner). */
function useQuiet<T>(key: string | undefined, load: () => Promise<T | null>): T | null | undefined {
  const [state, setState] = useState<Loaded<T | null> | undefined>()
  useEffect(() => {
    if (!key) return
    let live = true
    load().catch(() => null).then((value) => { if (live) setState({ key, value }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!key) return null
  return state?.key === key ? state.value : undefined
}

const SAFE_SHOT = (name: string): boolean =>
  name !== '' && !name.startsWith('/') && !name.includes('\\') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name)
  && !name.split('/').some((seg) => seg === '..' || seg === '.')

async function evidenceShots(task: string, round: number): Promise<{ src: string; name: string }[] | null> {
  const base = `evidence/${task}/r${round}`
  const text = await api.human(`${base}/manifest.json`)
  if (text === null) return null
  const manifest = JSON.parse(text) as { steps?: { screenshot?: unknown }[] }[]
  const out: { src: string; name: string }[] = []
  for (const scenario of Array.isArray(manifest) ? manifest : []) {
    for (const s of Array.isArray(scenario?.steps) ? scenario.steps : []) {
      if (typeof s?.screenshot === 'string' && SAFE_SHOT(s.screenshot)) out.push({ name: s.screenshot, src: `/api/human/${base}/${s.screenshot.split('/').map(encodeURIComponent).join('/')}` })
    }
  }
  return out
}

function HumanView({ task, round, onRawLink }: { task?: string; round: number; onRawLink: (id: string) => void }) {
  const doc = useQuiet(task, () => api.human(`iterations/${task}.md`))
  const shots = useQuiet(task ? `${task}/${round}` : undefined, () => evidenceShots(task!, round))
  if (!task) return <p className="panel-empty">태스크나 이벤트를 선택하세요</p>
  if (doc === undefined) return <p className="panel-empty">불러오는 중…</p>
  return (
    <div className="paper detail-paper">
      {doc === null ? <p className="paper-empty">아직 기록이 없습니다</p> : <Markdown source={doc} onRawLink={onRawLink} />}
      {shots && shots.length > 0 && (
        <section aria-label="증거 캡처">
          <h3 className="paper-h">증거 캡처 · r{round}</h3>
          <ul className="shots">
            {shots.map((s) => (
              <li key={s.name}><a href={s.src} target="_blank" rel="noreferrer"><img src={s.src} alt={s.name} loading="lazy" width={1280} height={720} /></a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    try { void navigator.clipboard?.writeText(text)?.then(() => setCopied(true), () => undefined) } catch { /* clipboard unavailable */ }
  }
  return (
    <section className="raw-block">
      <header><h4>{label}</h4><button type="button" className="btn" onClick={copy} aria-label={`${label} 복사`}>{copied ? '복사됨' : '복사'}</button></header>
      <pre className="mono raw-pre">{text}</pre>
    </section>
  )
}

function RawView({ event }: { event?: Envelope }) {
  const prompt = useQuiet(event?.promptRef ? event.id : undefined, () => api.prompt(event!.promptRef!))
  if (!event) return <p className="panel-empty">이벤트를 선택하세요</p>
  return (
    <div className="raw-view">
      <CopyBlock label="Envelope" text={JSON.stringify(event, null, 2)} />
      {event.promptRef && (prompt === undefined ? <p className="panel-empty">프롬프트 불러오는 중…</p>
        : prompt === null ? <p className="panel-empty">프롬프트를 찾을 수 없습니다</p>
        : <CopyBlock label="프롬프트" text={prompt} />)}
    </div>
  )
}

export function DetailTab({ events, state, selection, sub, onSub, onRawLink }: {
  events: Envelope[]; state: RunState; selection: Selection; sub: DetailSub
  onSub: (s: DetailSub) => void; onRawLink: (eventId: string) => void
}) {
  const event = selection.eventId ? events.find((e) => e.id === selection.eventId) : undefined
  const task = selection.taskId ?? event?.task
  const round = (task && state.tasks[task]?.round) || 1
  return (
    <div className="detail-tab">
      <div role="tablist" aria-label="상세 보기" className="subtabs">
        <button type="button" role="tab" aria-selected={sub === 'human'} onClick={() => onSub('human')}>사람용</button>
        <button type="button" role="tab" aria-selected={sub === 'raw'} onClick={() => onSub('raw')}>원본</button>
      </div>
      {sub === 'human' ? <HumanView task={task} round={round} onRawLink={onRawLink} /> : <RawView event={event} />}
    </div>
  )
}
