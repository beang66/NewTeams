import { useEffect, useState } from 'react'
import type { RunView } from '../api/useRun'
import { usageView } from '../model/usage'
import { LaneView } from '../components/LaneView'
import { PausedBanner } from '../components/PausedBanner'
import { SinceBar } from '../components/SinceBar'
import { TaskBoard } from '../components/TaskBoard'
import { TimelineList } from '../components/TimelineList'
import { TopBar } from '../components/TopBar'

const NARROW = '(max-width: 768px)'
function useMediaQuery(query: string): boolean {
  const get = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const on = () => setMatches(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Slots `.board`, `.lanes`, `.panel`, `.askbar` are filled by Tasks 6-9. */
export function ControlScreen({ run }: { run: RunView }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<string | undefined>()
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>()
  const [highlightIds, setHighlightIds] = useState<string[] | undefined>()
  const narrow = useMediaQuery(NARROW)
  const paused = usageView(run.events, run.state, run.agents, new Date()).paused
  return (
    <div className="control">
      <TopBar run={run} onOpenAttention={() => setPanelOpen(true)} />
      {paused && <PausedBanner paused={paused} />}
      <SinceBar events={run.events} onOpenTimeline={setHighlightIds} />
      <main className="control-grid">
        <aside className="board" aria-label="태스크 보드">
          <TaskBoard state={run.state} plan={run.plan} selectedTask={selectedTask} onSelect={setSelectedTask} />
        </aside>
        <section className="lanes" aria-label="레인">
          {narrow
            ? <TimelineList events={run.events} selectedId={selectedEventId} onSelectEvent={setSelectedEventId} />
            : <LaneView events={run.events} state={run.state} agents={run.agents} selectedId={selectedEventId}
                onSelectEvent={setSelectedEventId} highlightIds={highlightIds} />}
        </section>
        <aside className="panel" aria-label="오른쪽 패널" data-open={panelOpen ? '' : undefined} />
        <div className="askbar" />
      </main>
    </div>
  )
}
