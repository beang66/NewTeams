import { useState } from 'react'
import type { RunView } from '../api/useRun'
import { usageView } from '../model/usage'
import { PausedBanner } from '../components/PausedBanner'
import { SinceBar } from '../components/SinceBar'
import { TaskBoard } from '../components/TaskBoard'
import { TopBar } from '../components/TopBar'

/** Slots `.board`, `.lanes`, `.panel`, `.askbar` are filled by Tasks 6-9. */
export function ControlScreen({ run }: { run: RunView }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<string | undefined>()
  const paused = usageView(run.events, run.state, run.agents, new Date()).paused
  return (
    <div className="control">
      <TopBar run={run} onOpenAttention={() => setPanelOpen(true)} />
      {paused && <PausedBanner paused={paused} />}
      <SinceBar events={run.events} />
      <main className="control-grid">
        <aside className="board" aria-label="태스크 보드">
          <TaskBoard state={run.state} plan={run.plan} selectedTask={selectedTask} onSelect={setSelectedTask} />
        </aside>
        <section className="lanes" aria-label="레인" />
        <aside className="panel" aria-label="오른쪽 패널" data-open={panelOpen ? '' : undefined} />
        <div className="askbar" />
      </main>
    </div>
  )
}
