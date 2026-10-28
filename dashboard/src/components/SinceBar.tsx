import { useCallback, useEffect, useRef, useState } from 'react'
import type { Envelope } from '@orch/protocol/messages'
import { sinceLastVisit, sinceText, type Since } from '../model/since'

const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, v: string): void => { try { localStorage.setItem(key, v) } catch { /* storage unavailable */ } }

/** Project identity: no project name in state, so the first event's id + ts (stable per project). */
const storageKey = (events: Envelope[]): string | null => (events[0] ? `orch.lastSeen.${events[0].id}.${events[0].ts}` : null)

export function SinceBar({ events, onOpenTimeline, now }: { events: Envelope[]; onOpenTimeline?: (ids: string[]) => void; now?: Date }) {
  const [since, setSince] = useState<Since>({ kind: 'none' })
  const key = storageKey(events)
  const latest = events.length ? events[events.length - 1]!.id : null
  const ref = useRef({ key, latest, events })
  ref.current = { key, latest, events }
  const baselined = useRef<string | null>(null)

  const evaluate = useCallback(() => {
    const { key: k, latest: l, events: evs } = ref.current
    if (!k || !l) return
    const s = sinceLastVisit(evs, read(k))
    if (s.kind === 'unknown') write(k, l) // first visit / unknown id: re-baseline, show nothing
    setSince(s.kind === 'some' ? s : { kind: 'none' })
  }, [])

  // Baseline once per project when events first arrive; the summary is then frozen (live events don't churn it).
  useEffect(() => {
    if (key && baselined.current !== key) { baselined.current = key; evaluate() }
  }, [key, evaluate])

  const dismiss = useCallback(() => {
    const { key: k, latest: l } = ref.current
    if (k && l) write(k, l)
    setSince({ kind: 'none' })
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        const { key: k, latest: l } = ref.current
        if (k && l) write(k, l)
      } else evaluate()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [evaluate])

  const open = since.kind === 'some'
  useEffect(() => {
    if (!open) return
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [open, dismiss])

  if (since.kind !== 'some') return null
  return (
    <div className="since-bar">
      <button type="button" className="since-text" onClick={() => onOpenTimeline?.(since.ids)}>
        {sinceText(since, now ?? new Date())}
      </button>
      <button type="button" className="since-ok" onClick={dismiss}>확인함</button>
    </div>
  )
}
