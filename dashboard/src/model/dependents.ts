import type { Plan } from '@orch/protocol/plan'
import type { RunState } from '@orch/store/state'

const DONE = new Set(['approved', 'merged', 'blocked'])

/** Transitive dependents of `taskId` in the plan that are not already approved, merged or blocked. */
export function pendingDependents(taskId: string, plan: Plan | null | undefined, state: RunState | undefined): number {
  if (!plan) return 0
  const found = new Set<string>()
  const queue = [taskId]
  while (queue.length) {
    const cur = queue.pop()!
    for (const t of plan.tasks) {
      if (t.deps.includes(cur) && !found.has(t.id) && t.id !== taskId) { found.add(t.id); queue.push(t.id) }
    }
  }
  let n = 0
  for (const id of found) if (!DONE.has(state?.tasks[id]?.status ?? 'pending')) n += 1
  return n
}
