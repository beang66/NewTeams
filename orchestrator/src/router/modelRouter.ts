import { DEFAULT_CONFIG, type AgentProvider, type Config, type Role } from '../config.js'

export interface PickOpts { difficulty?: 'low' | 'mid' | 'high'; escalated?: boolean }

export function pickProvider(role: Role, config: Config = DEFAULT_CONFIG): AgentProvider {
  if (role === 'reviewer') return 'codex'
  return config.agents[role === 'master' || role === 'planner' ? 'master' : 'worker'].provider
}

// Unspecified Claude models retain the role defaults; Codex uses its CLI default.

export function pickModel(role: Role, o: PickOpts = {}, config: Config = DEFAULT_CONFIG): string {
  if (role !== 'reviewer') {
    const profile = config.agents[role === 'master' || role === 'planner' ? 'master' : 'worker']
    if (o.escalated && role === 'dev') return profile.escalatedModel ?? (profile.provider === 'claude' ? 'opus' : profile.model ?? 'codex-default')
    if (profile.model) return profile.model
    if (profile.provider === 'codex') return 'codex-default'
  }
  switch (role) {
    case 'master': return 'opus'
    case 'planner': return o.difficulty === 'low' ? 'sonnet' : 'opus'
    case 'dev': return o.escalated ? 'opus' : 'sonnet'
    case 'qa': return 'sonnet'
    case 'wiki': return 'haiku'
    case 'logQuery': return 'sonnet'
    case 'reviewer': return 'codex-default'
  }
}
