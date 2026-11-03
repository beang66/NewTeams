import { z } from 'zod'

export const QaScenarioSchema = z.object({ id: z.string(), steps: z.array(z.string()) })
export type QaScenario = z.infer<typeof QaScenarioSchema>

/** Task ids become git refs and filenames, including on Windows. */
function safeTaskId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)
}

export const PlanTaskSchema = z.object({
  id: z.string().refine(safeTaskId, '잘못된 태스크 id'),
  title: z.string(),
  deps: z.array(z.string()),
  ownedFiles: z.array(z.string()),
  difficulty: z.enum(['low', 'mid', 'high']),
  acceptance: z.array(z.string()),
  qaScenarios: z.array(QaScenarioSchema),
})
export type PlanTask = z.infer<typeof PlanTaskSchema>

export const PlanSchema = z.object({
  tasks: z.array(PlanTaskSchema),
  /** 테스트 전에 worktree에서 실행할 의존성 설치 명령. 이전 계획과 호환되도록 생략 가능. */
  setupCommands: z.array(z.string()).optional(),
  testCommands: z.array(z.string()),
  devCommand: z.string(),
})
export type Plan = z.infer<typeof PlanSchema>

/** 워크플로가 기획·최종 검수 이벤트에 쓰는 id. 태스크 id로 쓸 수 없다. */
export const RESERVED_TASK_IDS = ['plan', 'final'] as const

export function validatePlan(plan: Plan): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const task of plan.tasks) {
    if (!safeTaskId(task.id)) problems.push(`잘못된 태스크 id: ${task.id}`)
    if (ids.has(task.id)) problems.push(`중복 태스크 id: ${task.id}`)
    ids.add(task.id)
  }
  for (const id of RESERVED_TASK_IDS) if (ids.has(id)) problems.push(`예약된 태스크 id: ${id}`)

  const owners = new Map<string, string[]>()
  for (const t of plan.tasks) {
    for (const f of new Set(t.ownedFiles)) {
      owners.set(f, [...(owners.get(f) ?? []), t.id])
    }
  }
  for (const [file, who] of owners) {
    if (who.length > 1) problems.push(`${file}: ${who.join(', ')} 가 함께 소유`)
  }

  for (const t of plan.tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) problems.push(`${t.id}: 없는 의존 ${d}`)
    }
  }

  // DFS 순환 검사 (없는 의존은 무시)
  const byId = new Map(plan.tasks.map((t) => [t.id, t]))
  const state = new Map<string, 1 | 2>() // 1=방문중, 2=완료
  const stack: string[] = []
  const seenCycles = new Set<string>()
  const visit = (id: string): void => {
    state.set(id, 1)
    stack.push(id)
    for (const d of byId.get(id)?.deps ?? []) {
      if (!byId.has(d)) continue
      if (state.get(d) === 1) {
        const cycle = [...stack.slice(stack.indexOf(d)), d]
        const key = [...cycle.slice(0, -1)].sort().join(',')
        if (!seenCycles.has(key)) {
          seenCycles.add(key)
          problems.push(`의존 순환: ${cycle.join(' -> ')}`)
        }
      } else if (!state.has(d)) {
        visit(d)
      }
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const t of plan.tasks) if (!state.has(t.id)) visit(t.id)

  return problems
}
