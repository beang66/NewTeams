import type { RunView } from '../api/useRun'
import { clock, doneStats } from '../model/doneStats'

const Arrow = () => (
  <svg viewBox="0 0 20 40" width="20" height="100%" aria-hidden="true"><path d="M1 20 H17 M11 14 L17 20 L11 26" stroke="#141414" strokeWidth="1.5" fill="none" /></svg>
)

/** Figure 1: the path this run actually took, drawn from event counts only. */
export function DoneFigure({ run }: { run: RunView }) {
  const s = doneStats(run.events, run.state)
  const steps: { tag: string; title: string; sub: string; human?: boolean }[] = [
    { tag: '사람', title: '스펙 승인', sub: '요구사항 확정', human: true },
    { tag: '기획', title: `태스크 ${s.tasks}`, sub: '계획 수립' },
    { tag: '개발 ⇄ 검수', title: `반려 ${s.rejects} · 승인 ${s.approves}`, sub: s.humanCalls > 0 ? `사람 호출 ${s.humanCalls}` : '사람 호출 없음' },
    { tag: '최종 QA', title: '최종 검증', sub: '통과' },
    { tag: '완료', title: 'DONE', sub: s.lastTs ? clock(s.lastTs) : '' },
  ]
  return (
    <figure className="done-figure">
      <div className="done-flow">
        {steps.map((st, i) => (
          <div key={st.tag} className="done-flow-item">
            {i > 0 && <Arrow />}
            <div className={`stp${st.human ? ' human' : ''}`}><span className="tag">{st.tag}</span><h4>{st.title}</h4><p>{st.sub}</p></div>
          </div>
        ))}
      </div>
      <figcaption><b>그림 1.</b> 실제로 지나간 경로만 그렸다. 숫자는 이벤트 기록에서 센 값이다.</figcaption>
    </figure>
  )
}
