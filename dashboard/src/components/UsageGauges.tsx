import { useEffect, useState } from 'react'
import { api, type DashboardUsage } from '../api/client'
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

const usd = (n: number, has: boolean) => (has ? `$${n.toFixed(2)}` : '—')

/** 대시보드 전체(모든 프로젝트 + 스킬·루틴 실행) 사용량. 30초마다 다시 읽는다. */
function useDashboardUsage(): DashboardUsage | undefined {
  const [u, setU] = useState<DashboardUsage>()
  useEffect(() => {
    const load = () => { api.usageAll().then(setU).catch(() => undefined) }
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])
  return u
}

/**
 * 토큰·비용 한 묶음: 이 프로젝트(크게) → 모델별·API 상한 → 대시보드 전체 → 이 프로젝트 최근 7일 표.
 * 관제 화면 왼쪽 열 아래에 둔다(헤더는 이름·상태·결정만).
 */
export function UsagePanel({ usage, project }: { usage: UsageView; project?: string }) {
  const recent = usage.byDay.slice(-7).reverse()
  const all = useDashboardUsage()
  const ratio = usage.apiCapUsd > 0 ? Math.min(1, usage.apiSpendUsd / usage.apiCapUsd) : 0
  return (
    <section className="usage-panel" aria-label="토큰 사용량">
      <h2 className="usage-panel-title">토큰 사용량</h2>
      <div className="usage-block">
        <span className="usage-label">이 프로젝트{project ? ` · ${project}` : ''}</span>
        <span className="usage-big"><strong className="mono">{fmt.format(usage.totalTokens)}</strong> 토큰</span>
        <span className="usage-row"><span>기록 비용</span><span className="mono">{usd(usage.recordedCostUsd, usage.hasRecordedCost)}</span></span>
        <span className="usage-row"><span>Claude</span><span className="mono">{fmt.format(usage.byProvider.claude.tokens)}</span></span>
        <span className="usage-row"><span>GPT</span><span className="mono">{fmt.format(usage.byProvider.codex.tokens)}</span></span>
        <span className="usage-row"><span>API 지출</span><span className="mono">${usage.apiSpendUsd.toFixed(2)} / ${usage.apiCapUsd}</span></span>
        <span className="meter usage-meter" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
      </div>
      <div className="usage-block">
        <span className="usage-label">대시보드 전체{all ? ` · 프로젝트 ${all.projects.length}개·스킬 포함` : ''}</span>
        {all
          ? <><span className="usage-big"><strong className="mono">{fmt.format(all.total.tokens)}</strong> 토큰</span>
            <span className="usage-row"><span>기록 비용</span><span className="mono">{usd(all.total.costUsd, all.total.hasCost)}</span></span></>
          : <span className="usage-empty">불러오는 중…</span>}
      </div>
      <div className="usage-block">
        <span className="usage-label">최근 7일 · 이 프로젝트</span>
        {recent.length === 0 ? <span className="usage-empty">아직 기록된 사용량이 없습니다</span> : (
          <table className="usage-days-table">
            <thead><tr><th scope="col">날짜</th><th scope="col">토큰</th><th scope="col">비용</th></tr></thead>
            <tbody>
              {recent.map((day) => (
                <tr key={day.date}>
                  <td><time dateTime={day.date}>{day.date.slice(5).replace('-', '.')}</time></td>
                  <td className="mono">{fmt.format(day.tokens)}</td>
                  <td className="mono">{usd(day.costUsd, day.hasCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
