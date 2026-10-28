import type { AgentConfig } from '../api/client'

/** reviewer는 항상 codex. 그 밖은 /api/agents, 없으면 claude. */
export function providerOf(role: string, agents: AgentConfig | null): 'claude' | 'codex' {
  if (role === 'reviewer') return 'codex'
  return agents?.roles?.[role]?.provider ?? 'claude'
}
