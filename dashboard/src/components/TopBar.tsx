import type { ReactNode } from 'react'
import type { RunView } from '../api/useRun'
import { attentionItems } from '../model/attention'
import { usageView } from '../model/usage'
import { StageRail } from './StageRail'
import { UsageGauges } from './UsageGauges'
import { TelegramChip } from './TelegramChip'

interface Props { run: RunView; onOpenAttention?: () => void; now?: () => Date; hasSpecDraft?: boolean; extra?: ReactNode; view?: 'control' | 'overview'; onView?: (v: 'control' | 'overview') => void }

export function TopBar({ run, onOpenAttention, now = () => new Date(), hasSpecDraft = false, extra, view = 'control', onView }: Props) {
  const count = attentionItems(run.state, run.events, { hasSpecDraft }).length
  const usage = usageView(run.events, run.state, run.agents, now())
  return (
    <header className="topbar">
      <h1 className="topbar-title"><a href="#/" className="topbar-home" aria-label="홈으로">←</a> 에이전트 관제</h1>
      <StageRail stage={run.state.stage} />
      {onView && (
        <div className="seg" role="group" aria-label="화면 전환">
          <button type="button" aria-pressed={view === 'control'} onClick={() => onView('control')}>관제</button>
          <button type="button" aria-pressed={view === 'overview'} onClick={() => onView('overview')}>개요</button>
        </div>
      )}
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
