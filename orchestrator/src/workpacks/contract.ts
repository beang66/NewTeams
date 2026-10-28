import { z } from 'zod'
import {
  validateWorkGraph,
  type ArtifactRecord,
  type EvidenceRecord,
  type RunRecord,
  type WorkGraph,
  type WorkTaskRecord,
} from './model.js'

const KeySchema = z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

export const WorkPackManifestSchema = z.object({
  id: KeySchema,
  version: z.string().min(1),
  title: z.string().min(1),
  domain: KeySchema,
  description: z.string().min(1),
}).strict()
export type WorkPackManifest = z.infer<typeof WorkPackManifestSchema>

export const WorkRoleSchema = z.object({
  key: KeySchema,
  name: z.string().min(1),
  goal: z.string().min(1),
  backstory: z.string().min(1),
  tools: z.array(KeySchema),
}).strict()
export type WorkRole = z.infer<typeof WorkRoleSchema>

export const ArtifactRequirementSchema = z.object({
  kind: KeySchema,
  description: z.string().min(1),
  mediaTypes: z.array(z.string().min(1)).min(1),
  required: z.boolean(),
}).strict()
export type ArtifactRequirement = z.infer<typeof ArtifactRequirementSchema>

export const WorkTaskTemplateSchema = z.object({
  key: KeySchema,
  title: z.string().min(1),
  deps: z.array(KeySchema),
  role: KeySchema,
  instructions: z.string().min(1),
  acceptance: z.array(z.string().min(1)),
  outputs: z.array(ArtifactRequirementSchema),
}).strict()
export type WorkTaskTemplate = z.infer<typeof WorkTaskTemplateSchema>

export const WorkPackBlueprintSchema = z.object({
  title: z.string().min(1),
  tasks: z.array(WorkTaskTemplateSchema).min(1),
}).strict()
export type WorkPackBlueprint = z.infer<typeof WorkPackBlueprintSchema>

export interface PackReviewFinding {
  code: string
  severity: 'blocker' | 'major' | 'minor'
  message: string
  entityId?: string
}

export interface PackReviewContext<I> {
  run: RunRecord
  input: I
  tasks: WorkTaskRecord[]
  artifacts: ArtifactRecord[]
  evidence: EvidenceRecord[]
}

export interface WorkPack<I> {
  manifest: WorkPackManifest
  inputSchema: z.ZodType<I>
  /** 계약 자체를 실제 청사진까지 검사하기 위한 비밀값 없는 최소 입력. */
  exampleInput: I
  roles: WorkRole[]
  createBlueprint(input: I): WorkPackBlueprint
  review(context: PackReviewContext<I>): PackReviewFinding[]
}

export interface PackContractFinding {
  code: string
  message: string
}

export interface InstantiateOptions {
  projectId: string
  runId: string
  input: unknown
  createdAt: string
}

export interface WorkPackRunSlice {
  run: RunRecord
  tasks: WorkTaskRecord[]
}

export interface PackReviewResult {
  ok: boolean
  findings: PackReviewFinding[]
}

export class WorkPackContractError extends Error {
  constructor(readonly findings: PackContractFinding[]) {
    super(findings.map((finding) => finding.message).join('; '))
    this.name = 'WorkPackContractError'
  }
}

/** 팩 선언과 exampleInput에서 생성되는 청사진을 등록 전에 검사한다. */
export function validateWorkPack<I>(pack: WorkPack<I>): PackContractFinding[] {
  const findings: PackContractFinding[] = []
  const manifest = WorkPackManifestSchema.safeParse(pack.manifest)
  if (!manifest.success) findings.push({ code: 'invalid-manifest', message: manifest.error.message })

  const parsedInput = pack.inputSchema.safeParse(pack.exampleInput)
  if (!parsedInput.success) {
    findings.push({ code: 'invalid-example-input', message: parsedInput.error.message })
    return findings
  }

  findings.push(...validateRoles(pack.roles))
  try {
    findings.push(...validateBlueprint(pack.createBlueprint(parsedInput.data), pack.roles))
  } catch (error) {
    findings.push({ code: 'blueprint-error', message: `청사진 생성 실패: ${String(error)}` })
  }
  return findings
}

/** 팩 입력을 고정하고 태스크 key 의존을 실제 실행 태스크 id 의존으로 변환한다. */
export function instantiateWorkPackRun<I>(pack: WorkPack<I>, options: InstantiateOptions): WorkPackRunSlice {
  const input = pack.inputSchema.parse(options.input)
  const blueprint = pack.createBlueprint(input)
  const findings = [...validateRoles(pack.roles), ...validateBlueprint(blueprint, pack.roles)]
  if (findings.length) throw new WorkPackContractError(findings)

  const taskIdByKey = new Map(blueprint.tasks.map((task) => [task.key, `${options.runId}.${task.key}`]))
  const tasks = blueprint.tasks.map<WorkTaskRecord>((task) => ({
    id: taskIdByKey.get(task.key)!,
    runId: options.runId,
    key: task.key,
    title: task.title,
    deps: task.deps.map((dependency) => taskIdByKey.get(dependency)!),
    role: task.role,
    status: 'pending',
  }))
  return {
    run: {
      id: options.runId,
      projectId: options.projectId,
      workPack: { id: pack.manifest.id, version: pack.manifest.version },
      status: 'pending',
      input,
      createdAt: options.createdAt,
    },
    tasks,
  }
}

/** 공통 관계 무결성, 팩/입력/태스크 일치, 팩 고유 검수 순서로 판정한다. */
export function validatePackRun<I>(pack: WorkPack<I>, graph: WorkGraph, runId: string): PackReviewResult {
  const run = graph.runs.find((item) => item.id === runId)
  if (!run) return result([{ code: 'missing-run', severity: 'blocker', message: `실행 없음: ${runId}` }])

  const findings: PackReviewFinding[] = validateWorkGraph(sliceRunGraph(graph, run)).map((item) => ({
    code: `relationship:${item.code}`,
    severity: 'blocker',
    message: item.message,
    entityId: item.entityId,
  }))

  if (run.workPack.id !== pack.manifest.id || run.workPack.version !== pack.manifest.version) {
    findings.push({ code: 'pack-mismatch', severity: 'blocker', message: '실행에 고정된 작업 팩 id/version과 검수 팩이 다름', entityId: runId })
  }
  const input = pack.inputSchema.safeParse(run.input)
  if (!input.success) {
    findings.push({ code: 'invalid-run-input', severity: 'blocker', message: input.error.message, entityId: runId })
    return result(findings)
  }

  const tasks = graph.tasks.filter((task) => task.runId === runId)
  const artifacts = graph.artifacts.filter((artifact) => artifact.runId === runId)
  const evidence = graph.evidence.filter((item) => item.runId === runId)
  const blueprint = pack.createBlueprint(input.data)
  findings.push(...validateInstantiatedTasks(blueprint, tasks))
  findings.push(...validateRequiredOutputs(blueprint, tasks, artifacts))
  findings.push(...pack.review({ run, input: input.data, tasks, artifacts, evidence }))
  return result(findings)
}

function sliceRunGraph(graph: WorkGraph, run: RunRecord): WorkGraph {
  return {
    projects: graph.projects.filter((project) => project.id === run.projectId),
    runs: graph.runs.filter((item) => item.id === run.id),
    tasks: graph.tasks.filter((task) => task.runId === run.id),
    artifacts: graph.artifacts.filter((artifact) => artifact.runId === run.id),
    evidence: graph.evidence.filter((item) => item.runId === run.id),
  }
}

function result(findings: PackReviewFinding[]): PackReviewResult {
  return { ok: !findings.some((finding) => finding.severity === 'blocker' || finding.severity === 'major'), findings }
}

function validateRoles(roles: WorkRole[]): PackContractFinding[] {
  const findings: PackContractFinding[] = []
  const seen = new Set<string>()
  for (const role of roles) {
    const parsed = WorkRoleSchema.safeParse(role)
    if (!parsed.success) findings.push({ code: 'invalid-role', message: parsed.error.message })
    if (seen.has(role.key)) findings.push({ code: 'duplicate-role-key', message: `중복 역할 key: ${role.key}` })
    seen.add(role.key)
  }
  return findings
}

function validateBlueprint(blueprint: WorkPackBlueprint, roles: WorkRole[]): PackContractFinding[] {
  const parsed = WorkPackBlueprintSchema.safeParse(blueprint)
  if (!parsed.success) return [{ code: 'invalid-blueprint', message: parsed.error.message }]

  const findings: PackContractFinding[] = []
  const roleKeys = new Set(roles.map((role) => role.key))
  const taskKeys = new Set<string>()
  for (const task of blueprint.tasks) {
    if (taskKeys.has(task.key)) findings.push({ code: 'duplicate-task-key', message: `중복 태스크 key: ${task.key}` })
    taskKeys.add(task.key)
    if (!roleKeys.has(task.role)) findings.push({ code: 'missing-role', message: `${task.key}: 없는 역할 ${task.role}` })
  }
  for (const task of blueprint.tasks) {
    for (const dependency of task.deps) {
      if (!taskKeys.has(dependency)) findings.push({ code: 'missing-dependency', message: `${task.key}: 없는 의존 ${dependency}` })
    }
  }
  findings.push(...findBlueprintCycles(blueprint))
  return findings
}

function findBlueprintCycles(blueprint: WorkPackBlueprint): PackContractFinding[] {
  const byKey = new Map(blueprint.tasks.map((task) => [task.key, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const findings: PackContractFinding[] = []
  const reported = new Set<string>()

  const visit = (key: string, path: string[]): void => {
    if (visiting.has(key)) {
      const cycle = [...path.slice(path.indexOf(key)), key]
      const identity = [...new Set(cycle)].sort().join('|')
      if (!reported.has(identity)) {
        reported.add(identity)
        findings.push({ code: 'dependency-cycle', message: `청사진 의존 순환: ${cycle.join(' → ')}` })
      }
      return
    }
    if (visited.has(key)) return
    visiting.add(key)
    for (const dependency of byKey.get(key)?.deps ?? []) if (byKey.has(dependency)) visit(dependency, [...path, key])
    visiting.delete(key)
    visited.add(key)
  }

  for (const task of blueprint.tasks) visit(task.key, [])
  return findings
}

function validateInstantiatedTasks(blueprint: WorkPackBlueprint, tasks: WorkTaskRecord[]): PackReviewFinding[] {
  const expected = new Set(blueprint.tasks.map((task) => task.key))
  const actual = new Set(tasks.map((task) => task.key))
  const findings: PackReviewFinding[] = []
  for (const key of expected) if (!actual.has(key)) findings.push({ code: 'missing-task', severity: 'blocker', message: `팩 태스크 없음: ${key}` })
  for (const key of actual) if (!expected.has(key)) findings.push({ code: 'unexpected-task', severity: 'major', message: `팩에 없는 태스크: ${key}` })
  return findings
}

function validateRequiredOutputs(
  blueprint: WorkPackBlueprint,
  tasks: WorkTaskRecord[],
  artifacts: ArtifactRecord[],
): PackReviewFinding[] {
  const taskByKey = new Map(tasks.map((task) => [task.key, task]))
  const findings: PackReviewFinding[] = []
  for (const template of blueprint.tasks) {
    const task = taskByKey.get(template.key)
    if (!task) continue
    for (const requirement of template.outputs.filter((output) => output.required)) {
      const artifact = artifacts.find((item) => item.taskId === task.id && item.kind === requirement.kind)
      if (!artifact) {
        findings.push({
          code: 'missing-required-artifact', severity: 'blocker', entityId: task.id,
          message: `${template.title}: 필수 산출물 ${requirement.kind} 없음`,
        })
      } else if (!requirement.mediaTypes.includes(artifact.mediaType)) {
        findings.push({
          code: 'invalid-artifact-media-type', severity: 'blocker', entityId: artifact.id,
          message: `${requirement.kind}: 허용되지 않은 media type ${artifact.mediaType}`,
        })
      }
    }
  }
  return findings
}
