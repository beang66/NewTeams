import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunView } from '../api/useRun'
import { attentionItems } from '../model/attention'
import { AttentionTab } from './AttentionTab'
import { DetailTab, type DetailSub, type Selection } from './DetailTab'
import { MasterTab } from './MasterTab'
import { UsagePanel } from './UsageGauges'
import type { UsageView } from '../model/usage'

export type PanelTab = 'attention' | 'master' | 'detail' | 'usage'
const TABS: { id: PanelTab; label: string }[] = [
  { id: 'attention', label: '주의' }, { id: 'master', label: '마스터' }, { id: 'detail', label: '상세' }, { id: 'usage', label: '토큰 사용량' },
]
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Props {
  run: RunView
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  selection: Selection
  onSelectEvent?: (eventId: string) => void
  onSelectTask?: (taskId: string) => void
  onOpenSpec?: () => void
  hasSpecDraft?: boolean
  /** Optional lift of the Detail sub-tab so callers can open the Raw view directly. */
  sub?: DetailSub
  onSub?: (sub: DetailSub) => void
  /** Drawer state at <=1024px; on wide screens the panel is always visible. */
  open?: boolean
  onClose?: () => void
  usage?: UsageView
  project?: string
}

export function RightPanel({ run, tab, onTab, selection, onSelectEvent, onSelectTask, onOpenSpec, hasSpecDraft = false, sub: subProp, onSub, open, onClose, usage, project }: Props) {
  const [subLocal, setSubLocal] = useState<DetailSub>('human')
  const sub = subProp ?? subLocal
  const setSub = onSub ?? setSubLocal
  const ref = useRef<HTMLElement>(null)
  const items = useMemo(() => attentionItems(run.state, run.events, { hasSpecDraft }), [run.state, run.events, hasSpecDraft])

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current?.() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus() }
  }, [open])

  const showEvidence = (taskId: string) => { onSelectTask?.(taskId); setSub('human'); onTab('detail') }
  const showRaw = (eventId: string) => { onSelectEvent?.(eventId); setSub('raw'); onTab('detail') }

  return (
    <aside ref={ref} className="panel" aria-labelledby="panel-title" data-open={open ? '' : undefined}>
      {/* 카드 제목(h3)의 상위 제목. 화면에는 탭이 그 역할을 하므로 숨긴다. */}
      <h2 id="panel-title" className="sr-only">오른쪽 패널</h2>
      <div role="tablist" aria-label="패널 탭" className="panel-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`ptab-${t.id}`} aria-selected={tab === t.id} aria-controls="ppanel" onClick={() => onTab(t.id)}>
            {t.label}{t.id === 'attention' && items.length > 0 ? ` ${items.length}` : ''}
          </button>
        ))}
        {onClose && <button type="button" className="panel-close" onClick={onClose} aria-label="패널 닫기">닫기</button>}
      </div>
      <div role="tabpanel" id="ppanel" aria-labelledby={`ptab-${tab}`} className="panel-body">
        {tab === 'attention' && (
          <AttentionTab items={items} plan={run.plan} state={run.state} onEvidence={showEvidence} onOpenSpec={onOpenSpec} />
        )}
        {tab === 'usage' && (usage ? <UsagePanel usage={usage} project={project} /> : <p className="panel-empty">사용량을 불러오는 중입니다</p>)}
        {tab === 'master' && <MasterTab events={run.events} stage={run.state.stage} />}
        {tab === 'detail' && (
          <DetailTab events={run.events} state={run.state} selection={selection} sub={sub} onSub={setSub} onRawLink={showRaw} />
        )}
      </div>
    </aside>
  )
}
