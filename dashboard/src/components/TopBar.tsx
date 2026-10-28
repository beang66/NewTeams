import type { RunView } from '../api/useRun'
import { attentionItems } from '../model/attention'
import { usageView } from '../model/usage'
import { StageRail } from './StageRail'
import { UsageGauges } from './UsageGauges'
import { TelegramChip } from './TelegramChip'

export function TopBar({ run, onOpenAttention, now = () => new Date() }: { run: RunView; onOpenAttention?: () => void; now?: () => Date }) {
  const count = attentionItems(run.state, run.events, { hasSpecDraft: false }).length
  const usage = usageView(run.events, run.state, run.agents, now())
  return (
    <header className="topbar">
      <h1 className="topbar-title">에이전트 관제</h1>
      <StageRail stage={run.state.stage} />
      <div className="topbar-right">
        <UsageGauges usage={usage} />
        <button type="button" className={`attention-btn${count > 0 ? ' is-alert' : ''}`} onClick={onOpenAttention}>{`주의 ${count}`}</button>
        <TelegramChip />
        {!run.connected && <span className="chip is-warn">연결 끊김 — 다시 연결 중</span>}
      </div>
    </header>
  )
}
