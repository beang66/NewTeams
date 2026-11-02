import type { Plan } from '@orch/protocol/plan'
import type { RunState, TaskStatus } from '@orch/store/state'
import { boardGroups, type BoardGroup } from '../model/board'
import { PIPELINE_DEFAULTS } from '../model/pipeline'

interface Props {
  state: RunState
  plan: Plan | null
  selectedTask?: string
  onSelect: (taskId: string) => void
  rejectLimit?: number
}

const CHIP: Record<TaskStatus, { text: string; tone: string }> = {
  pending: { text: '대기', tone: '' },
  running: { text: '개발', tone: 'is-accent' },
  review: { text: '검수', tone: 'is-accent' },
  rejected: { text: '반려', tone: 'is-bad' },
  approved: { text: '승인', tone: 'is-ok' },
  merged: { text: '병합', tone: 'is-ok' },
  blocked: { text: '건너뜀', tone: '' },
}

function chipFor(group: BoardGroup, status: TaskStatus, round: number, limit: number): { text: string; tone: string } {
  if (group === 'rejected') return { text: `r${round}/${limit}`, tone: 'is-bad' }
  return CHIP[status] ?? { text: '-', tone: '' }
}

export function TaskBoard({ state, plan, selectedTask, onSelect, rejectLimit = PIPELINE_DEFAULTS.rejectLimit }: Props) {
  if (!plan) return <p className="board-empty">기획이 끝나면 태스크가 여기에 나타납니다</p>
  return (
    <div className="task-board">
      {boardGroups(state, plan).map((g) => (
        <section key={g.group} className="board-group">
          <h2>{g.label} {g.tasks.length}</h2>
          <ul>
            {g.tasks.map((t) => {
              const chip = chipFor(g.group, t.status, t.round, rejectLimit)
              return (
                <li key={t.id}>
                  <button type="button" className="board-task" aria-pressed={selectedTask === t.id} onClick={() => onSelect(t.id)}>
                    <span className="mono board-task-id">{t.id}</span>
                    <span className="truncate" title={t.title}>{t.title}</span>
                    <span className={`chip ${chip.tone}`.trim()}>{chip.text}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
