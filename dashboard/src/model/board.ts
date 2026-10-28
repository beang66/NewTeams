import type { Plan } from '@orch/protocol/plan'
import type { RunState, TaskStatus } from '@orch/store/state'

export type BoardGroup = 'review' | 'rejected' | 'running' | 'pending' | 'done' | 'blocked'
interface BoardTask { id: string; title: string; round: number; status: TaskStatus }

const GROUPS: { group: BoardGroup; label: string; statuses: TaskStatus[] }[] = [
  { group: 'review', label: '검수 중', statuses: ['review'] },
  { group: 'rejected', label: '반려', statuses: ['rejected'] },
  { group: 'running', label: '진행 중', statuses: ['running'] },
  { group: 'pending', label: '대기', statuses: ['pending'] },
  { group: 'done', label: '완료', statuses: ['approved', 'merged'] },
  { group: 'blocked', label: '건너뜀', statuses: ['blocked'] },
]

export function boardGroups(state: RunState, plan: Plan | null): { group: BoardGroup; label: string; tasks: BoardTask[] }[] {
  const titles = new Map((plan?.tasks ?? []).map((t) => [t.id, t.title]))
  const ids = [...titles.keys()].filter((id) => state.tasks[id]).concat(Object.keys(state.tasks).filter((id) => !titles.has(id) && id !== 'plan' && id !== 'final'))
  const tasks: BoardTask[] = ids.map((id) => ({ id, title: titles.get(id) ?? id, round: state.tasks[id]!.round, status: state.tasks[id]!.status }))
  return GROUPS
    .map((g) => ({ group: g.group, label: g.label, tasks: tasks.filter((t) => g.statuses.includes(t.status)) }))
    .filter((g) => g.tasks.length > 0)
}
