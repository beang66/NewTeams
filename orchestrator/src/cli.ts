#!/usr/bin/env node
import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
import { buildServer, listenLocal } from './server/http.js'
import { attachNotifier, consoleNotifier, NOTIFY_TYPES } from './server/notifier.js'
import { TelegramBot } from './telegram/bot.js'
import { BotApi } from './telegram/botApi.js'
import { readTelegramSecrets, redact, type TelegramSecrets } from './telegram/env.js'

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
    const dashboardDir = resolveDashboardDir(options.dashboard)
    const { app } = assembleServe(cfg, wf, process.env, { dashboardDir })
    installServeShutdown(app)
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
interface ServeOptions extends TelegramOptions { clock?: Clock; dashboardDir?: string }

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
  const app = buildServer(wf, { resume: true, actions, dashboardDir: options.dashboardDir, telegramStatus: () => bot?.status() ?? { state: 'off' } })
  app.addHook('onListen', async () => {
    if (!bot) { log('텔레그램: 꺼짐 (환경 변수 없음)'); return }
    // Telegram 장애나 getMe 지연이 HTTP listen 및 workflow drive를 기다리게 하지 않는다.
    void bot.start().then(() => {
      const status = bot.status()
      if (status.state === 'connected') log(`텔레그램: @${status.botUsername ?? ''} 연결됨`)
    }).catch(error => console.warn(`텔레그램: ${safeTelegramError(error, secrets)}`))
  })
  app.addHook('onClose', async () => {
    detachConsole(); detachTelegram?.()
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
  const close = () => {
    void app.close().catch(() => { console.error('서버 종료 실패'); process.exitCode = 1 })
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  app.addHook('onClose', async () => {
    process.off('SIGINT', close)
    process.off('SIGTERM', close)
  })
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
