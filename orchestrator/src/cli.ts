#!/usr/bin/env node
import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { loadConfig, resolveConfig, type AgentProvider, type Config } from './config.js'
import { systemClock, type Clock } from './clock.js'
import { ProjectStore } from './store/projectStore.js'
import { Workflow } from './engine/workflow.js'
import { AgentRunner } from './runners/agentRunner.js'
import { CodexRunner } from './runners/codexRunner.js'
import { OpenAIRunner } from './runners/openaiRunner.js'
import { ReviewerRunner } from './runners/reviewerRunner.js'
import { createWorkflowActions } from './server/actions.js'
import { usePipelineNotes } from './context/contextBuilder.js'
import { loadGraph, traverse } from './context/expertGraph.js'
import { buildServer, listenLocal, type ProjectHandle } from './server/http.js'
import { Vault } from './vault/vault.js'
import { ClaudeRunner } from './runners/claudeRunner.js'
import { listSkills } from './skills/skills.js'
import { SkillRuns } from './skills/runs.js'
import { Routines } from './skills/routines.js'
import { attachNotifier, consoleNotifier, NOTIFY_TYPES } from './server/notifier.js'
import { TelegramBot } from './telegram/bot.js'
import { BotApi } from './telegram/botApi.js'
import { readTelegramSecrets, redact, type TelegramSecrets } from './telegram/env.js'
import { stopOwnedChildren } from './runners/ownedChildren.js'

export function createProgram(onServe: (app: FastifyInstance) => void = installServeShutdown): Command {
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
    const dashboardDir = resolveDashboardDir(options.dashboard)
    const projects = await openOthers(cfg, name)
    const { app } = assembleServe(cfg, wf, process.env, { dashboardDir, projects })
    onServe(app)
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
  program.command('telegram-check').description('텔레그램 연결 확인 메시지 한 건 전송').action(async () => {
    await telegramCheck(config(), process.env)
  })
  return program
}

interface TelegramOptions { api?: BotApi; log?: (message: string) => void }
interface ServeOptions extends TelegramOptions { clock?: Clock; dashboardDir?: string; projects?: ProjectHandle[] }

/** HTTP와 Telegram이 동일한 직렬화 동작을 공유하고 서버 생명주기로 함께 종료된다. */
export function assembleServe(cfg: Config, wf: Workflow, env: NodeJS.ProcessEnv, options: ServeOptions = {}) {
  const secrets = readTelegramSecrets(env)
  const log = options.log ?? console.log
  const actions = createWorkflowActions(wf, async error => {
    const detail = safeTelegramError(error, secrets)
    console.error('Workflow failed; answer the human request to retry', detail)
    await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', payload: { reason: 'workflow_error', detail } })
  })
  const bot = secrets ? new TelegramBot({ secrets, cfg: cfg.telegram, wf, actions, clock: options.clock ?? systemClock, api: options.api }) : undefined
  const detachConsole = attachNotifier(wf.bus, consoleNotifier)
  const detachTelegram = bot ? attachNotifier(wf.bus, bot, [...NOTIFY_TYPES, 'RESUMED', 'APPROVE']) : undefined
  const vault = openVault(cfg, env, log)
  // 에이전트는 실행할 때마다 Vault의 파이프라인 설계·완수 기준 노트를 읽는다(고정된 노트 이름만, 노트당 8천 자까지).
  usePipelineNotes(vault && ((note) => {
    const rel = `${cfg.vault.pipeline}/${note}.md`
    try { return { path: rel, text: readFileSync(join(vault.root, rel), 'utf8').slice(0, 8000) } } catch { return undefined }
  }), vault && ((key) => traverse(loadGraph(join(vault.root, cfg.vault.graph), vault.root), key)))
  // 스킬 실행 기록·고정 목록·루틴은 프로젝트 폴더의 skill-runs/에 둔다. 루틴은 서버가 켜져 있을 때만 돈다.
  const repoDir = fileURLToPath(new URL('../../', import.meta.url))
  const skillDir = join(wf.store.paths.raw, '..', 'skill-runs')
  // 고정 목록은 프로젝트 폴더(git에서 빠짐·프로젝트마다 다름)가 아니라 사용자 홈에 하나만 둔다.
  const runs = new SkillRuns(skillDir, new ClaudeRunner(cfg), () => listSkills(repoDir), cfg.timeoutsMs.master, undefined, join(homedir(), '.newteams', 'pinned-skills.json'))
  const routines = new Routines(join(skillDir, 'routines.json'), runs)
  const skills = { list: () => listSkills(repoDir), runs, routines }
  const app = buildServer(wf, { resume: true, actions, projects: options.projects, dashboardDir: options.dashboardDir, telegramStatus: () => bot?.status() ?? { state: 'off' }, vault, skills })
  app.addHook('onListen', async () => { routines.start() })
  app.addHook('onListen', async () => {
    if (!bot) { log('텔레그램: 꺼짐 (환경 변수 없음)'); return }
    // Telegram 장애나 getMe 지연이 HTTP listen 및 workflow drive를 기다리게 하지 않는다.
    void bot.start().then(() => {
      const status = bot.status()
      if (status.state === 'connected') log(`텔레그램: @${status.botUsername ?? ''} 연결됨`)
    }).catch(error => console.warn(`텔레그램: ${safeTelegramError(error, secrets)}`))
  })
  app.addHook('onClose', async () => {
    detachConsole(); detachTelegram?.(); routines.stop()
    await bot?.stop()
  })
  return { app, bot, actions }
}

/** 실제 CLI에서는 환경 변수만 읽으며, 테스트는 루프백 API/명시적 env를 주입한다. */
export async function telegramCheck(cfg: Config, env: NodeJS.ProcessEnv, options: TelegramOptions = {}): Promise<void> {
  const secrets = readTelegramSecrets(env)
  if (!secrets) throw new Error('TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID를 모두 설정하세요.')
  const api = options.api ?? new BotApi(secrets.token, cfg.telegram.apiBase)
  const log = options.log ?? console.log
  try {
    const me = await api.getMe()
    await api.sendMessage(secrets.chatId, '연결 확인 ✓')
    log(`텔레그램: @${me.username} 연결됨`)
  } catch (error) { throw new Error(`텔레그램 연결 확인 실패: ${safeTelegramError(error, secrets)}`) }
}

export function installServeShutdown(app: FastifyInstance): void {
  const detach = installCliShutdown(() => app.close())
  app.addHook('onClose', async () => { detach() })
}

/** 실제 CLI의 signal 경계. 자식 트리를 종료한 뒤 남은 gate/타이머와 함께 프로세스를 끝낸다. */
export function installCliShutdown(close: () => Promise<unknown> = async () => {}): () => void {
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    // close가 진행되는 동안에도 다음 러너/체크 프로세스 생성을 차단한다.
    const childrenStopped = stopOwnedChildren()
    void finishCliShutdown(close, childrenStopped)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return () => {
    if (stopping) return // 트리 종료 중 추가 signal의 기본 동작으로 부모만 종료되면 안 된다.
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
  }
}

async function finishCliShutdown(close: () => Promise<unknown>, childrenStopped: Promise<void>): Promise<void> {
  let code = 0
  let timer: NodeJS.Timeout | undefined
  // 활성 HTTP 요청도 인증 gate를 기다릴 수 있으므로 graceful close만 무한 대기하지 않는다.
  const closing = Promise.resolve().then(close).catch(() => { console.error('서버 종료 실패'); code = 1 })
  const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, 3000) })
  try {
    await Promise.all([childrenStopped, Promise.race([closing, deadline])])
  } catch {
    console.error('자식 프로세스 종료 실패')
    // OS가 트리 종료를 거부했으면 자식을 고아로 남기고 강제 종료하지 않는다.
    process.exitCode = 1
    return
  } finally {
    if (timer) clearTimeout(timer)
  }
  process.exit(code)
}

function safeTelegramError(error: unknown, secrets: TelegramSecrets | null): string {
  const message = redact(error instanceof Error ? error.message : String(error), secrets?.token)
  return secrets ? message.split(secrets.chatId).join('[chat]') : message
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

/**
 * 같은 서버에서 함께 열 다른 프로젝트들. 프로젝트마다 대시보드에 자기 관제 페이지(#/run/<이름>)가 생긴다.
 * 텔레그램은 serve로 지정한 주 프로젝트만 연결한다.
 */
async function openOthers(cfg: Config, primary: string): Promise<ProjectHandle[]> {
  const root = resolve(cfg.projectsDir)
  const names = (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && d.name !== primary).map((d) => d.name)
  const out: ProjectHandle[] = []
  for (const n of names) {
    let wf: Workflow
    try { wf = await openExisting(cfg, n) } catch { continue } // 프로젝트가 아닌 폴더·이름 규칙에 맞지 않는 폴더
    const actions = createWorkflowActions(wf, async (error) => {
      console.error(`[${n}] Workflow failed`, error)
      await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', payload: { reason: 'workflow_error', detail: error instanceof Error ? error.message : String(error) } })
    })
    attachNotifier(wf.bus, consoleNotifier)
    out.push({ name: n, wf, actions })
  }
  return out
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
  let serving: FastifyInstance | undefined
  installCliShutdown(async () => { await serving?.close() })
  createProgram(app => { serving = app }).parseAsync().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

/**
 * ORCH_VAULT_DIR 또는 설정의 vault.path로 Obsidian Vault를 연다(로컬 우선).
 * 로컬 폴더가 없고 vault.github가 있으면 ~/.cache/newteams/vault에 얕은 clone(이미 있으면 pull)해서 읽는다.
 */
export function openVault(cfg: Config, env: NodeJS.ProcessEnv, log: (message: string) => void = console.log, run: typeof gitRun = gitRun): Vault | undefined {
  const local = env.ORCH_VAULT_DIR?.trim() || cfg.vault.path
  const remote = local && existsSync(local) ? null : cfg.vault.github
  if (!local && !remote) { log('Obsidian: 꺼짐 (ORCH_VAULT_DIR 또는 vault.path 없음)'); return undefined }
  const root = remote ? join(homedir(), '.cache', 'newteams', 'vault') : local!
  const vault = new Vault({ root, read: cfg.vault.read, inbox: cfg.vault.inbox })
  // shortcut: GitHub 사본은 시작 시 한 번만 동기화하고 AI Inbox 쓰기는 push하지 않음. 계속 쓰려면 주기 pull과 push가 필요
  const ready = remote
    ? run(existsSync(join(root, '.git')) ? ['-C', root, 'pull', '--ff-only'] : ['clone', '--depth', '1', remote, root])
    : Promise.resolve()
  void ready.then(() => vault.check()).then(
    () => log(`Obsidian: ${remote ? `${remote} → ` : ''}${vault.root} (읽기 ${cfg.vault.read.join(', ')})`),
    (error) => log(`Obsidian: ${String(error instanceof Error ? error.message : error)}`))
  return vault
}

function gitRun(args: string[]): Promise<void> {
  return new Promise((ok, fail) => { execFile('git', args, (error) => error ? fail(error) : ok()) })
}
