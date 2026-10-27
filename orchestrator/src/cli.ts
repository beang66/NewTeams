#!/usr/bin/env node
import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { loadConfig, resolveConfig, type AgentProvider, type Config } from './config.js'
import { systemClock } from './clock.js'
import { ProjectStore } from './store/projectStore.js'
import { Workflow } from './engine/workflow.js'
import { AgentRunner } from './runners/agentRunner.js'
import { CodexRunner } from './runners/codexRunner.js'
import { OpenAIRunner } from './runners/openaiRunner.js'
import { ReviewerRunner } from './runners/reviewerRunner.js'
import { buildServer, listenLocal } from './server/http.js'
import { attachNotifier, consoleNotifier } from './server/notifier.js'

export function createProgram(): Command {
  const program = new Command().name('orch').description('로컬 멀티 에이전트 오케스트레이터')
    .option('--config <path>', 'JSON 설정 파일 경로')
  const config = () => loadConfig(program.opts<{ config?: string }>().config)
  program.command('configure').description('마스터/작업 AI 설정 파일 생성')
    .requiredOption('--master <provider>', 'claude 또는 codex')
    .requiredOption('--worker <provider>', 'claude 또는 codex')
    .option('--master-model <model>', '마스터/기획 모델 (생략 시 기본 모델)')
    .option('--worker-model <model>', '개발/QA/위키 모델 (생략 시 역할 기본 모델)')
    .option('--escalated-model <model>', '작업 교착 시 상향 모델')
    .requiredOption('-o, --output <path>', '새 JSON 설정 파일 경로')
    .action(async (options: { master: AgentProvider; worker: AgentProvider; masterModel?: string; workerModel?: string; escalatedModel?: string; output: string }) => {
      const cfg = resolveConfig({ ...config(), agents: {
        master: { provider: options.master, ...(options.masterModel ? { model: options.masterModel } : {}) },
        worker: { provider: options.worker, ...(options.workerModel ? { model: options.workerModel } : {}), ...(options.escalatedModel ? { escalatedModel: options.escalatedModel } : {}) },
      } })
      await fs.writeFile(options.output, JSON.stringify(cfg, null, 2) + '\n', { flag: 'wx' })
      console.log(`AI 설정 생성: ${resolve(options.output)}`)
    })
  program.command('new <name>').description('프로젝트 생성').action(async (name: string) => {
    const cfg = config()
    const dir = projectPath(cfg, name)
    await fs.mkdir(resolve(cfg.projectsDir), { recursive: true })
    try { await fs.mkdir(dir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`이미 존재하는 프로젝트: ${name}`)
      throw error
    }
    await new ProjectStore(dir).init()
    console.log(`프로젝트 생성: ${dir}`)
  })
  program.command('serve <name>').description('서버 시작 및 작업 재개')
    .option('--dashboard <dir>', '대시보드 빌드 폴더 (기본: 저장소 dashboard/dist)')
    .action(async (name: string, options: { dashboard?: string }) => {
    const cfg = config()
    const wf = await openExisting(cfg, name)
    const detach = attachNotifier(wf.bus, consoleNotifier)
    const dashboardDir = resolveDashboardDir(options.dashboard)
    const app = buildServer(wf, { resume: true, ...(dashboardDir ? { dashboardDir } : {}) })
    app.addHook('onClose', async () => { detach() })
    try {
      const address = await listenLocal(app, cfg.port)
      console.log(`오케스트레이터: ${address}`)
      if (dashboardDir) console.log(`대시보드: ${address.replace(/\/?$/, '/')}`)
    } catch (error) {
      await app.close(); throw error
    }
  })
  program.command('chat <name>').description('터미널 대화 (/approve, /exit)').action(async (name: string) => {
    await runTerminalChat(await openExisting(config(), name))
  })
  return program
}

/** 명시한 폴더, 없으면 저장소 dashboard/dist(src와 dist 모두 orchestrator/ 한 단계 아래)에 index.html이 있을 때만 사용. */
export function resolveDashboardDir(explicit?: string): string | undefined {
  if (explicit) return explicit
  const fallback = fileURLToPath(new URL('../../dashboard/dist/', import.meta.url))
  return existsSync(join(fallback, 'index.html')) ? fallback.replace(/[\\/]$/, '') : undefined
}

export async function runTerminalChat(wf: Workflow, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  if (wf.state().stage !== 'INTAKE') throw new Error('INTAKE 단계가 아닙니다. orch serve로 재개하세요.')
  const lines = createInterface({ input, crlfDelay: Infinity })
  output.write('요구사항을 입력하세요. /approve: 스펙 승인, /exit: 종료\n> ')
  try {
    for await (const line of lines) {
      const message = line.trim()
      if (message === '/exit') break
      if (message === '/approve') {
        await wf.approveSpec()
        output.write('스펙 승인 완료. orch serve <name>으로 실행하세요.\n')
        break
      }
      if (message) {
        const response = await wf.chat(message)
        output.write(`${response.reply}\n`)
        if (response.specDraft) output.write(`\n스펙 초안:\n${response.specDraft}\n`)
      }
      output.write('> ')
    }
  } finally { lines.close() }
}

function projectPath(cfg: Config, name: string): string {
  // One directory component on both Windows and POSIX; excludes Windows device names.
  if (!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(name) || /[.]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error(`잘못된 프로젝트 이름: ${name}`)
  }
  return join(resolve(cfg.projectsDir), name)
}

async function openExisting(cfg: Config, name: string): Promise<Workflow> {
  const dir = projectPath(cfg, name)
  try { await fs.access(join(dir, 'workspace/.git')) } catch { throw new Error(`프로젝트 없음: ${name}. orch new로 생성하세요.`) }
  return Workflow.open(dir, {
    config: cfg, clock: systemClock, claude: new AgentRunner(cfg),
    reviewer: (spend) => new ReviewerRunner(new CodexRunner(cfg), new OpenAIRunner(cfg, spend)),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createProgram().parseAsync().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
