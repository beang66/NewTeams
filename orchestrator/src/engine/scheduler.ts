import type { Plan, PlanTask } from '../protocol/plan.js'
import type { RunState, TaskStatus } from '../store/state.js'

const WAITING: ReadonlySet<TaskStatus> = new Set(['pending', 'rejected'])
const ACTIVE: ReadonlySet<TaskStatus> = new Set(['running', 'review'])

const statusOf = (state: RunState, id: string): TaskStatus => state.tasks[id]?.status ?? 'pending'

/** 의존이 모두 merged(main에 병합됨)이고 pending/rejected인 태스크를 계획 순서로, (상한 − 실행 중) 개까지. */
export function readyTasks(plan: Plan, state: RunState, maxParallel: number): PlanTask[] {
  const active = plan.tasks.filter((t) => ACTIVE.has(statusOf(state, t.id))).length
  const room = Math.max(0, maxParallel - active)
  return plan.tasks
    .filter((t) => WAITING.has(statusOf(state, t.id)) && t.deps.every((d) => statusOf(state, d) === 'merged'))
    .slice(0, room)
}

/** 의존 순서. 계획 순서대로 훑으며 의존이 모두 나온 태스크를 내보내기를 반복한다. 없는 의존은 무시, 순환은 남은 순서대로 붙인다. */
export function topoOrder(plan: Plan): PlanTask[] {
  const ids = new Set(plan.tasks.map((t) => t.id))
  const emitted = new Set<string>()
  const out: PlanTask[] = []
  let progress = true
  while (progress && out.length < plan.tasks.length) {
    progress = false
    for (const t of plan.tasks) {
      if (emitted.has(t.id)) continue
      if (t.deps.every((d) => !ids.has(d) || emitted.has(d))) {
        emitted.add(t.id)
        out.push(t)
        progress = true
      }
    }
  }
  for (const t of plan.tasks) if (!emitted.has(t.id)) out.push(t)
  return out
}
