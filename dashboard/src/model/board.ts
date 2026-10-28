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
  const planTasks = plan?.tasks ?? []
  const titles = new Map(planTasks.map((t) => [t.id, t.title]))
  // Every plan task is shown; a task with no state entry yet has never been assigned, so it is pending.
  const extraIds = Object.keys(state.tasks).filter((id) => !titles.has(id) && id !== 'plan' && id !== 'final')
  const tasks: BoardTask[] = [...planTasks.map((t) => t.id), ...extraIds].map((id) => {
    const s = state.tasks[id]
    return { id, title: titles.get(id) ?? id, round: s?.round ?? 0, status: s?.status ?? 'pending' }
  })
  return GROUPS
    .map((g) => ({ group: g.group, label: g.label, tasks: tasks.filter((t) => g.statuses.includes(t.status)) }))
    .filter((g) => g.tasks.length > 0)
}
