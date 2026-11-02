import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RunView } from '../api/useRun'
import { useHashParam } from '../api/hashState'
import { usageView } from '../model/usage'
import { LaneView } from '../components/LaneView'
import { AskBar } from '../components/AskBar'
import type { DetailSub } from '../components/DetailTab'
import { RightPanel, type PanelTab } from '../components/RightPanel'
import { PausedBanner } from '../components/PausedBanner'
import { DecisionQueue } from '../components/DecisionQueue'
import { pipelineIdle, startWithConfirm } from '../components/PipelineControl'
import { attentionItems } from '../model/attention'
import { decisionsOf, type Decision } from '../model/decisions'
import { SinceBar } from '../components/SinceBar'
import { TaskBoard } from '../components/TaskBoard'
import { TimelineList } from '../components/TimelineList'
import { TopBar, useProjectName } from '../components/TopBar'
import { PipelineOverview } from './PipelineOverview'

const PANEL_TABS = ['attention', 'master', 'detail', 'usage'] as const satisfies readonly PanelTab[]
const DETAIL_SUBS = ['human', 'raw'] as const satisfies readonly DetailSub[]

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

interface Props {
  run: RunView
  hasSpecDraft?: boolean
  /** Open straight on this event's raw log entry (used when a report link jumps here). */
  initialRawEvent?: string
  topBarExtra?: ReactNode
}

export function ControlScreen({ run, hasSpecDraft = false, initialRawEvent, topBarExtra }: Props) {
  const [panelOpen, setPanelOpen] = useState(initialRawEvent !== undefined)
  const [selectedTask, setSelectedTask] = useState<string | undefined>()
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(initialRawEvent)
  const [tab, setTab] = useHashParam<PanelTab>('tab', initialRawEvent ? 'detail' : 'attention', PANEL_TABS, !initialRawEvent)
  const [sub, setSub] = useHashParam<DetailSub>('sub', initialRawEvent ? 'raw' : 'human', DETAIL_SUBS, !initialRawEvent)
  const [highlightIds, setHighlightIds] = useState<string[] | undefined>()
  const [view, setView] = useState<'control' | 'overview'>('control')
  const closePanel = useCallback(() => setPanelOpen(false), [])
  const selectEvent = (id: string) => { setSelectedEventId(id); setSelectedTask(undefined); setTab('detail') }
  const selectTask = (id: string) => { setSelectedTask(id); setSelectedEventId(undefined); setTab('detail') }
  const showRaw = (id: string) => { selectEvent(id); setSub('raw'); setPanelOpen(true) }
  // Overview links jump back to the control view with the right panel open on that task / message.
  const openTask = (id: string) => { selectTask(id); setSub('human'); setPanelOpen(true); setView('control') }
  const openRaw = (id: string) => { showRaw(id); setView('control') }
  const narrow = useMediaQuery(NARROW)
  const usage = usageView(run.events, run.state, run.agents, new Date())
  const paused = usage.paused
  const project = useProjectName()
  const decisions = useMemo(() => decisionsOf(attentionItems(run.state, run.events, { hasSpecDraft }), pipelineIdle(run.state)), [run.state, run.events, hasSpecDraft])
  // 결정 하나를 고르면 오른쪽 패널의 '주의' 탭에서 그 카드로 바로 간다.
  const openDecision = (d: Decision) => {
    if (d.item.kind === 'start') { void startWithConfirm().catch((e: unknown) => window.alert(e instanceof Error ? e.message : String(e))); return }
    setView('control'); setTab('attention'); setPanelOpen(true)
    // 패널이 열리면서 첫 버튼에 포커스를 주므로, 그 뒤에 카드로 옮긴다.
    setTimeout(() => {
      const card = document.getElementById(`decision-${d.key}`)
      card?.scrollIntoView({ block: 'nearest' })
      const target = card?.querySelector<HTMLElement>('textarea') ?? card?.querySelector<HTMLElement>('button')
      target?.focus()
    })
  }
  return (
    <div className="control">
      <TopBar run={run} hasSpecDraft={hasSpecDraft} extra={topBarExtra} onOpenAttention={() => { setTab('attention'); setPanelOpen(true) }} view={view} onView={setView} />
      {paused && <PausedBanner paused={paused} />}
      <SinceBar events={run.events} onOpenTimeline={setHighlightIds} />
      <DecisionQueue decisions={decisions} onOpen={openDecision} />
      {view === 'overview' ? (
        <main className="control-grid is-overview">
          <PipelineOverview run={run} onOpenTask={openTask} onShowRaw={openRaw} />
          <AskBar events={run.events} onRawLink={openRaw} />
        </main>
      ) : (
        <main className="control-grid">
          <aside className="board" aria-label="태스크 보드">
            <TaskBoard state={run.state} plan={run.plan} selectedTask={selectedTask} onSelect={selectTask} />
          </aside>
          <section className="lanes" aria-label="레인">
            {narrow
              ? <TimelineList events={run.events} selectedId={selectedEventId} onSelectEvent={selectEvent} />
              : <LaneView events={run.events} state={run.state} agents={run.agents} selectedId={selectedEventId}
                  onSelectEvent={selectEvent} highlightIds={highlightIds} />}
          </section>
          <RightPanel run={run} hasSpecDraft={hasSpecDraft} sub={sub} onSub={setSub} tab={tab} onTab={setTab} selection={{ eventId: selectedEventId, taskId: selectedTask }}
            onSelectEvent={selectEvent} onSelectTask={selectTask} open={panelOpen} onClose={closePanel} usage={usage} project={project} />
          <AskBar events={run.events} onRawLink={showRaw} />
        </main>
      )}
    </div>
  )
}
