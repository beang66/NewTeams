import type { ReactNode } from 'react'
import type { RunView } from '../api/useRun'
import { attentionItems } from '../model/attention'
import { usageView } from '../model/usage'
import { StageRail } from './StageRail'
import { UsageGauges } from './UsageGauges'
import { TelegramChip } from './TelegramChip'

interface Props { run: RunView; onOpenAttention?: () => void; now?: () => Date; hasSpecDraft?: boolean; extra?: ReactNode }

export function TopBar({ run, onOpenAttention, now = () => new Date(), hasSpecDraft = false, extra }: Props) {
  const count = attentionItems(run.state, run.events, { hasSpecDraft }).length
  const usage = usageView(run.events, run.state, run.agents, now())
  return (
    <header className="topbar">
      <h1 className="topbar-title">에이전트 관제</h1>
      <StageRail stage={run.state.stage} />
      <div className="topbar-right">
        {extra}
        <UsageGauges usage={usage} />
        <button type="button" className={`attention-btn${count > 0 ? ' is-alert' : ''}`} onClick={onOpenAttention}>{`주의 ${count}`}</button>
        <TelegramChip />
        {!run.connected && <span className="chip is-warn">연결 끊김 — 다시 연결 중</span>}
      </div>
    </header>
  )
}
