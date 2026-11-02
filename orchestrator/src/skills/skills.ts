import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 대시보드 옵션의 모델 이름 → claude --model 값 */
export const SKILL_MODELS: Record<string, string> = { '기본 모델': 'default', Opus: 'opus', Sonnet: 'sonnet', Haiku: 'haiku', Fable: 'claude-fable-5-1' }
export const SKILL_EFFORTS = ['기본', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export class SkillNotFound extends Error {}

export interface SkillInfo { name: string; desc: string; source: 'user' | 'project' | 'plugin' }

/** SKILL.md 머리말의 name·description. description은 한 줄이거나 `>`·`|` 뒤 들여쓴 여러 줄이다. */
export function parseSkill(text: string): { name: string; desc: string } | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (!fm) return null
  const lines = fm.split(/\r?\n/)
  const value = (key: string): string => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (i < 0) return ''
    const inline = lines[i]!.slice(key.length + 1).trim()
    if (inline && !/^[>|][-+]?$/.test(inline)) return inline.replace(/^(['"])(.*)\1$/, '$2')
    const rest: string[] = []
    for (const l of lines.slice(i + 1)) { if (!/^\s/.test(l)) break; rest.push(l.trim()) }
    return rest.join(' ').trim()
  }
  const name = value('name')
  return name ? { name, desc: value('description') } : null
}

async function readDir(dir: string, source: SkillInfo['source'], prefix = ''): Promise<SkillInfo[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: SkillInfo[] = []
  for (const n of names) {
    const parsed = parseSkill(await fs.readFile(join(dir, n, 'SKILL.md'), 'utf8').catch(() => ''))
    if (parsed) out.push({ name: prefix + parsed.name, desc: parsed.desc, source })
  }
  return out
}

/** 켜진 플러그인의 설치 경로. 꺼진 플러그인·예전 버전 캐시는 뺀다. */
async function enabledPluginDirs(home: string): Promise<{ plugin: string; dir: string }[]> {
  try {
    const enabled = (JSON.parse(await fs.readFile(join(home, '.claude', 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean> }).enabledPlugins ?? {}
    const installed = (JSON.parse(await fs.readFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, { installPath: string }[]> }).plugins ?? {}
    return Object.entries(installed).filter(([id]) => enabled[id]).flatMap(([id, v]) => v.slice(-1).map((e) => ({ plugin: id.split('@')[0]!, dir: e.installPath })))
  } catch { return [] }
}

/** 이 PC에 설치된 Claude Code 스킬: 사용자(~/.claude/skills) · 저장소(.claude/skills) · 켜진 플러그인. */
export async function listSkills(repoDir: string, home = homedir()): Promise<SkillInfo[]> {
  const plugins = await enabledPluginDirs(home)
  const all = [
    ...(await readDir(join(home, '.claude', 'skills'), 'user')),
    ...(await readDir(join(repoDir, '.claude', 'skills'), 'project')),
    ...(await Promise.all(plugins.map((p) => readDir(join(p.dir, 'skills'), 'plugin', `${p.plugin}:`)))).flat(),
  ]
  const seen = new Set<string>()
  return all.filter((s) => !seen.has(s.name) && seen.add(s.name)).sort((a, b) => a.name.localeCompare(b.name))
}
