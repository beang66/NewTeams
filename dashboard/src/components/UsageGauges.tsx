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
      {usage.hasRecordedCost && (
        <span className="usage-item" title="실행 이벤트에 기록된 비용 합계">
          <span className="usage-name">기록 비용</span>
          <span className="mono">{`$${usage.recordedCostUsd.toFixed(2)}`}</span>
        </span>
      )}
    </div>
  )
}

export function UsageDailyStrip({ usage }: { usage: UsageView }) {
  const recent = usage.byDay.slice(-7).reverse()
  return (
    <section className="usage-daily" aria-label="토큰 사용 요약">
      <strong>총 <span className="mono">{fmt.format(usage.totalTokens)}</span> 토큰</strong>
      <span className="usage-daily-cost mono">API ${usage.apiSpendUsd.toFixed(2)} · 기록 비용 {usage.hasRecordedCost ? `$${usage.recordedCostUsd.toFixed(2)}` : '—'}</span>
      <div className="usage-days" aria-label="최근 일별 사용량">
        {recent.length === 0
          ? <span className="usage-empty">아직 기록된 사용량이 없습니다</span>
          : recent.map((day) => (
            <span key={day.date} className="usage-day">
              <time dateTime={day.date}>{day.date.slice(5).replace('-', '.')}</time>
              <span className="mono">{fmt.format(day.tokens)}</span>
              {day.hasCost && <small className="mono">${day.costUsd.toFixed(2)}</small>}
            </span>
          ))}
      </div>
    </section>
  )
}
