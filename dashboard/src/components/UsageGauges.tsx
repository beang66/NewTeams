import type { UsageView } from '../model/usage'

const fmt = new Intl.NumberFormat('ko-KR')
const NAMES = { claude: 'Claude', codex: 'GPT' } as const

export function UsageGauges({ usage }: { usage: UsageView }) {
  const ratio = usage.apiCapUsd > 0 ? Math.min(1, usage.apiSpendUsd / usage.apiCapUsd) : 0
  return (
    <div className="usage" aria-label="사용량">
      {(['claude', 'codex'] as const).map((p) => (
        <span key={p} className="usage-item" title={`캐시 ${fmt.format(usage.byProvider[p].cached)}`}>
          <span className="usage-name">{NAMES[p]}</span>
          <span className="mono">{fmt.format(usage.byProvider[p].tokens)}</span>
        </span>
      ))}
      <span className="usage-item" title="API 지출 / 상한">
        <span className="usage-name">API</span>
        <span className="mono">{`$${usage.apiSpendUsd.toFixed(2)} / $${usage.apiCapUsd}`}</span>
        <span className="meter" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
      </span>
    </div>
  )
}
