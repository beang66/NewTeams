import { z } from 'zod'

const IdSchema = z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, '안전하지 않은 id')
const TimestampSchema = z.string().datetime({ offset: true })
const MetadataSchema = z.record(z.string(), z.unknown())

function isSafeRelativePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return normalized.length > 0
    && !normalized.startsWith('/')
    && !/^[a-zA-Z]:\//.test(normalized)
    && !normalized.split('/').includes('..')
}

export const WorkPackRefSchema = z.object({
  id: IdSchema,
  version: z.string().min(1),
}).strict()
export type WorkPackRef = z.infer<typeof WorkPackRefSchema>

export const ProjectRecordSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  status: z.enum(['active', 'archived']),
  createdAt: TimestampSchema,
}).strict()
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>

export const RunRecordSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  workPack: WorkPackRefSchema,
  status: z.enum(['pending', 'running', 'waiting', 'failed', 'completed']),
  input: z.unknown(),
  createdAt: TimestampSchema,
}).strict()
export type RunRecord = z.infer<typeof RunRecordSchema>

export const WorkTaskRecordSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  key: IdSchema,
  title: z.string().min(1),
  deps: z.array(IdSchema),
  role: IdSchema,
  status: z.enum(['pending', 'running', 'review', 'rejected', 'completed', 'blocked']),
}).strict()
export type WorkTaskRecord = z.infer<typeof WorkTaskRecordSchema>

export const ArtifactRecordSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  taskId: IdSchema,
  kind: IdSchema,
  path: z.string().refine(isSafeRelativePath, '산출물 경로는 실행 디렉터리 안의 상대 경로여야 함'),
  mediaType: z.string().min(1),
  createdAt: TimestampSchema,
  metadata: MetadataSchema,
}).strict()
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>

export const EvidenceRecordSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  taskId: IdSchema,
  artifactId: IdSchema.optional(),
  criterionId: IdSchema,
  kind: z.enum(['source', 'test', 'browser', 'review', 'calculation', 'rights']),
  uri: z.string().min(1),
  observedAt: TimestampSchema,
  metadata: MetadataSchema,
}).strict()
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>

export const WorkGraphSchema = z.object({
  projects: z.array(ProjectRecordSchema),
  runs: z.array(RunRecordSchema),
  tasks: z.array(WorkTaskRecordSchema),
  artifacts: z.array(ArtifactRecordSchema),
  evidence: z.array(EvidenceRecordSchema),
}).strict()
export type WorkGraph = z.infer<typeof WorkGraphSchema>

export interface RelationshipFinding {
  code: string
  entityId: string
  message: string
}

/** 프로젝트 → 실행 → 태스크 → 산출물·근거의 참조 및 태스크 DAG 무결성을 검사한다. */
export function validateWorkGraph(graph: WorkGraph): RelationshipFinding[] {
  const indexes = indexGraph(graph)
  return [
    ...findDuplicateIds(graph),
    ...validateRuns(graph, indexes),
    ...validateTasks(graph, indexes),
    ...validateArtifacts(graph, indexes),
    ...validateEvidence(graph, indexes),
    ...findDependencyCycles(graph.tasks),
  ]
}

interface GraphIndexes {
  projects: Map<string, ProjectRecord>
  runs: Map<string, RunRecord>
  tasks: Map<string, WorkTaskRecord>
  artifacts: Map<string, ArtifactRecord>
}

function indexGraph(graph: WorkGraph): GraphIndexes {
  return {
    projects: new Map(graph.projects.map((item) => [item.id, item])),
    runs: new Map(graph.runs.map((item) => [item.id, item])),
    tasks: new Map(graph.tasks.map((item) => [item.id, item])),
    artifacts: new Map(graph.artifacts.map((item) => [item.id, item])),
  }
}

function finding(code: string, entityId: string, message: string): RelationshipFinding {
  return { code, entityId, message }
}

function findDuplicateIds(graph: WorkGraph): RelationshipFinding[] {
  const groups: Array<[string, Array<{ id: string }>]> = [
    ['project', graph.projects], ['run', graph.runs], ['task', graph.tasks],
    ['artifact', graph.artifacts], ['evidence', graph.evidence],
  ]
  const findings: RelationshipFinding[] = []
  for (const [kind, records] of groups) {
    const seen = new Set<string>()
    for (const record of records) {
      if (seen.has(record.id)) findings.push(finding('duplicate-id', record.id, `${kind} id가 중복됨: ${record.id}`))
      seen.add(record.id)
    }
  }
  return findings
}

function validateRuns(graph: WorkGraph, indexes: GraphIndexes): RelationshipFinding[] {
  return graph.runs.flatMap((run) => indexes.projects.has(run.projectId)
    ? []
    : [finding('missing-project', run.id, `실행이 없는 프로젝트를 참조함: ${run.projectId}`)])
}

function validateTasks(graph: WorkGraph, indexes: GraphIndexes): RelationshipFinding[] {
  const findings: RelationshipFinding[] = []
  for (const task of graph.tasks) {
    if (!indexes.runs.has(task.runId)) findings.push(finding('missing-run', task.id, `태스크가 없는 실행을 참조함: ${task.runId}`))
    for (const dependencyId of task.deps) {
      const dependency = indexes.tasks.get(dependencyId)
      if (!dependency) findings.push(finding('missing-dependency', task.id, `없는 의존 태스크: ${dependencyId}`))
      else if (dependency.runId !== task.runId) findings.push(finding('cross-run-dependency', task.id, `다른 실행의 태스크에 의존함: ${dependencyId}`))
    }
  }
  return findings
}

function validateArtifacts(graph: WorkGraph, indexes: GraphIndexes): RelationshipFinding[] {
  const findings: RelationshipFinding[] = []
  for (const artifact of graph.artifacts) {
    if (!indexes.runs.has(artifact.runId)) findings.push(finding('missing-run', artifact.id, `산출물이 없는 실행을 참조함: ${artifact.runId}`))
    const task = indexes.tasks.get(artifact.taskId)
    if (!task) findings.push(finding('missing-task', artifact.id, `산출물이 없는 태스크를 참조함: ${artifact.taskId}`))
    else if (task.runId !== artifact.runId) findings.push(finding('cross-run-artifact', artifact.id, '산출물과 태스크의 실행이 다름'))
  }
  return findings
}

function validateEvidence(graph: WorkGraph, indexes: GraphIndexes): RelationshipFinding[] {
  const findings: RelationshipFinding[] = []
  for (const evidence of graph.evidence) {
    if (!indexes.runs.has(evidence.runId)) findings.push(finding('missing-run', evidence.id, `근거가 없는 실행을 참조함: ${evidence.runId}`))
    const task = indexes.tasks.get(evidence.taskId)
    if (!task) findings.push(finding('missing-task', evidence.id, `근거가 없는 태스크를 참조함: ${evidence.taskId}`))
    else if (task.runId !== evidence.runId) findings.push(finding('cross-run-evidence', evidence.id, '근거와 태스크의 실행이 다름'))

    if (!evidence.artifactId) continue
    const artifact = indexes.artifacts.get(evidence.artifactId)
    if (!artifact) findings.push(finding('missing-artifact', evidence.id, `근거가 없는 산출물을 참조함: ${evidence.artifactId}`))
    else if (artifact.runId !== evidence.runId || artifact.taskId !== evidence.taskId) {
      findings.push(finding('cross-run-evidence', evidence.id, '근거와 산출물의 실행 또는 태스크가 다름'))
    }
  }
  return findings
}

function findDependencyCycles(tasks: WorkTaskRecord[]): RelationshipFinding[] {
  const findings: RelationshipFinding[] = []
  const tasksByRun = new Map<string, WorkTaskRecord[]>()
  for (const task of tasks) tasksByRun.set(task.runId, [...(tasksByRun.get(task.runId) ?? []), task])
  for (const runTasks of tasksByRun.values()) findings.push(...findRunCycles(runTasks))
  return findings
}

function findRunCycles(tasks: WorkTaskRecord[]): RelationshipFinding[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const reported = new Set<string>()
  const findings: RelationshipFinding[] = []

  const visit = (taskId: string, path: string[]): void => {
    if (visiting.has(taskId)) {
      const cycle = [...path.slice(path.indexOf(taskId)), taskId]
      const key = [...new Set(cycle)].sort().join('|')
      if (!reported.has(key)) {
        reported.add(key)
        findings.push(finding('dependency-cycle', taskId, `태스크 의존 순환: ${cycle.join(' → ')}`))
      }
      return
    }
    if (visited.has(taskId)) return
    visiting.add(taskId)
    for (const dependency of byId.get(taskId)?.deps ?? []) if (byId.has(dependency)) visit(dependency, [...path, taskId])
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const task of tasks) visit(task.id, [])
  return findings
}
