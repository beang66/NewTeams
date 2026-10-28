import type { ReactNode } from 'react'
import type { TaskStatus } from '@orch/store/state'
import type { RunView } from '../api/useRun'
import { doneStats, formatDuration } from '../model/doneStats'
import { stageLabel } from '../model/labels'
import { PIPELINE_DEFAULTS as D, pipelineView, WHOLE_RUN, type StepState } from '../model/pipeline'

interface Props {
  run: RunView
  /** Open the Detail [사람용] tab for this task. */
  onOpenTask?: (taskId: string) => void
  /** Open the Raw tab at this message id. */
  onShowRaw?: (eventId: string) => void
}

const STATUS_TEXT: Record<TaskStatus, string> = { pending: '대기', running: '개발', review: '검수', rejected: '반려', approved: '승인', merged: '병합', blocked: '건너뜀' }
const STATUS_TONE: Record<TaskStatus, string> = { pending: 'plain', running: 'now', review: 'now', rejected: 'bad', approved: 'ok', merged: 'ok', blocked: 'plain' }
const ROLE_TEXT: Record<string, string> = { master: '마스터', planner: '기획', dev: '개발', qa: 'QA', reviewer: '리뷰어' }
const num = (n: number) => n.toLocaleString('ko-KR')

function Arrow({ future }: { future?: boolean }) {
  return <svg className="ov-arrow" viewBox="0 0 24 40" width="24" height="100%" aria-hidden="true" style={{ color: future ? 'var(--p-hair)' : 'var(--p-rule)' }}><path d="M2 20 H20 M14 14 L20 20 L14 26" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
}

function Step({ state, tag, title, children }: { state: StepState; tag: string; title: string; children?: ReactNode }) {
  const cls = state === 'future' ? 'muted' : state
  return (
    <div className={`stp ${cls}`} aria-current={state === 'now' ? 'step' : undefined}>
      <span className="tag">{tag}</span><h4>{title}</h4>{children && <p>{children}</p>}
    </div>
  )
}

function Row({ steps }: { steps: { key: string; node: ReactNode; future: boolean }[] }) {
  return (
    <div className="ov-row" style={{ gridTemplateColumns: steps.map((_, i) => (i === 0 ? '1fr' : '24px 1fr')).join(' ') }}>
      {steps.map((s, i) => <span key={s.key} className="ov-cell" style={{ display: 'contents' }}>{i > 0 && <Arrow future={s.future} />}{s.node}</span>)}
    </div>
  )
}

function Section({ n, title, label }: { n: number; title: string; label: string }) {
  return <div className="ov-sec"><span className="num">{n}</span><h3>{title}</h3><span className="lbl">{label}</span></div>
}

export function PipelineOverview({ run, onOpenTask = () => undefined, onShowRaw = () => undefined }: Props) {
  const v = pipelineView(run)
  const stats = doneStats(run.events, run.state)
  const stage = run.state.stage
  const worker = v.fixed.startsWith('작업 C') ? 'Claude' : 'GPT'
  const link = (label: ReactNode, onClick: () => void, name?: string) => <button type="button" className="lk" aria-label={name} onClick={onClick}>{label}</button>
  const raw = (id: string) => link(id, () => onShowRaw(id), id)
  const inLoop = stage === 'BUILD'
  const loopState: StepState = inLoop ? 'now' : ['INTAKE', 'SPEC_APPROVED', 'SEED', 'PLAN'].includes(stage) ? 'future' : 'done'
  const reviewing = v.loop.reviewingTask
  const st = v.tasks.map((t) => t.status)
  const allApproved = st.length > 0 && st.every((x) => x === 'approved' || x === 'merged')
  const anyMerged = st.some((x) => x === 'merged')
  const allMerged = st.length > 0 && st.every((x) => x === 'merged')
  // During BUILD each box reflects task statuses; outside BUILD the whole loop is done or not yet reached.
  const pick = (now: boolean, done: boolean): StepState => (loopState !== 'now' ? loopState : now ? 'now' : done ? 'done' : 'future')
  const anyReview = st.includes('review')
  const loopSteps: { key: string; tag: string; title: string; note: ReactNode; state: StepState }[] = [
    { key: 'dev', tag: '개발', title: '할 일만 받고 구현', note: '시드 포크 · 자기 소유 파일만', state: pick(st.includes('running'), allApproved) },
    { key: 'harness', tag: '하네스 · 코드', title: '테스트 재실행', note: '소유 범위·증거 확인 · 토큰 0', state: pick(anyReview, allApproved) },
    { key: 'qa', tag: 'QA', title: '브라우저로 직접 조작', note: '시나리오별 캡처 + manifest', state: pick(anyReview, allApproved) },
    { key: 'review', tag: '검수 · GPT 읽기 전용', title: 'diff + 증거만 보고 판정', note: reviewing ? link(`지금 ${reviewing} 검수 중`, () => onOpenTask(reviewing)) : '', state: pick(!!reviewing, allApproved) },
    { key: 'merge', tag: '승인 → 병합', title: 'main에 바로 병합', note: '의존 태스크가 풀림', state: pick(anyMerged && !allMerged, allMerged) },
  ]
  const finishText: Record<string, [string, string, string]> = {
    INTEGRATE: ['통합', '남은 승인 태스크 병합', '충돌은 해당 개발 세션이 해결'],
    FINAL_QA: ['최종 QA ⇄ 검수', '전체 시나리오 확인', '반려 시 수정 태스크로 되돌아감'],
    REPORT: ['보고 · 마스터', '근거 링크가 달린 평가', 'report.md'],
    DONE: ['완료', 'DONE', '위키는 태스크 승인마다 이미 갱신됨'],
  }
  const intakeText: Record<string, [string, string]> = { INTAKE: ['요구사항', '마스터와 대화'], SPEC_APPROVED: ['사람', '스펙 승인'], SEED: ['시드', '공통 맥락 1회'], PLAN: ['기획 ⇄ 검수', '태스크와 시나리오 만들기'] }
  const secLabel = (s: StepState, doneText: string) => (s === 'future' ? '아직 시작 전' : s === 'now' ? '지금 여기' : doneText)

  return (
    <section className="paper overview" aria-label="파이프라인 개요">
      <div className="ov-main">
        <div className="ov-head">
          <div>
            <h2 className="ov-title">{`파이프라인 개요: 작업은 ${worker}, 판정은 GPT`}</h2>
            <p className="by">
              현재 <b>{stageLabel[stage]}</b> 단계
              {stats.durationMs !== undefined && ` · 경과 ${formatDuration(stats.durationMs)}`}
              {stats.firstId && stats.lastId && <> · 원본 {raw(stats.firstId)}{stats.lastId !== stats.firstId && <> ~ {raw(stats.lastId)}</>}</>}
            </p>
          </div>
          <div className="ov-fixed"><span className="fixed">고정 조건 · 같은 설정으로 끝까지</span><span className="fixed">{v.fixed}</span></div>
        </div>

        <Section n={1} title="요구사항에서 계획까지" label="한 번만 지나감" />
        <Row steps={v.intake.map((s) => ({ key: s.stage, future: s.state === 'future', node: <Step state={s.state} tag={intakeText[s.stage]![0]} title={intakeText[s.stage]![1]}>{s.note}</Step> }))} />

        <Section n={2} title="태스크마다 승인될 때까지 도는 루프" label={`병렬 최대 ${D.maxParallel}`} />
        <div className="ov-loop">
          <Row steps={loopSteps.map((s) => ({ key: s.key, future: s.state === 'future', node: <Step state={s.state} tag={s.tag} title={s.title}>{s.note}</Step> }))} />
          <svg className="ov-return" viewBox="0 0 1000 70" width="100%" height="70" preserveAspectRatio="none" aria-hidden="true">
            <path d="M770 2 V40 H110 V8" className={v.loop.reviewRejects > 0 ? 'ret' : 'ret zero'} />
            <path d="M104 14 L110 4 L116 14" className={v.loop.reviewRejects > 0 ? 'ret' : 'ret zero'} />
            <path d="M350 2 V22 H130" className={v.loop.harnessRejects > 0 ? 'ret thin' : 'ret thin zero'} />
          </svg>
          <div className="ov-return-labels">
            <span>{`반려 → 지적 ID만 들고 같은 세션에서 수정 (이번 프로젝트 ${v.loop.reviewRejects}회)`}</span>
            <span>{`하네스 반려: GPT 호출 없이 즉시 (${v.loop.harnessRejects}회)`}</span>
          </div>
          <div className="ov-pair">
            <div className={`stp bad${v.loop.deadlocks > 0 ? '' : ' muted'}`}>
              <span className="tag">교착 · 자동 판단</span>
              <h4>{`같은 지적 ${D.repeatFindingLimit}회 또는 반려 ${D.rejectLimit}회 → 마스터`}</h4>
              <p>{`지침 · 재분할 · 모델 상향 중 하나 · 자동 판단 ${v.loop.deadlocks}회`}</p>
            </div>
            <div className={`stp human${v.loop.humanOpen.length > 0 ? '' : ' muted'}`}>
              <span className="tag">사람</span>
              <h4>마스터로도 안 풀리면 주의 카드</h4>
              <p>{v.loop.humanOpen.length > 0
                ? <>지금 {v.loop.humanOpen.map((t) => <span key={t}>{t === WHOLE_RUN ? t : link(t, () => onOpenTask(t))} </span>)}대기 중</>
                : '지금 기다리는 태스크 없음'}</p>
            </div>
          </div>
        </div>

        <Section n={3} title="합쳐서 다시 확인하고 마무리" label={secLabel(v.finish[0]!.state, '끝남')} />
        <Row steps={v.finish.map((s) => ({ key: s.stage, future: s.state === 'future', node: <Step state={s.state} tag={finishText[s.stage]![0]} title={finishText[s.stage]![1]}>{finishText[s.stage]![2]}</Step> }))} />
        <p className="cap"><b>그림 1.</b> 굵은 선은 지나간 단계, 라벤더 테두리는 지금 위치, 회색은 아직 오지 않은 단계, 점선 빨강은 되돌아간 경로다. 숫자는 이벤트 기록에서 센 값이다.</p>
      </div>

      <aside className="ov-aside" aria-label="태스크와 토큰">
        <h3>태스크별 루프</h3>
        {v.tasks.length === 0
          ? <p className="paper-empty">기획이 끝나면 태스크가 여기에 나타납니다</p>
          : (
            <table>
              <thead><tr><th>태스크</th><th className="r">회차</th><th className="r">반려</th><th>상태</th></tr></thead>
              <tbody>
                {v.tasks.map((t) => {
                  const needs = v.loop.humanOpen.includes(t.id)
                  const tone = needs ? 'bad' : STATUS_TONE[t.status]
                  return (
                    <tr key={t.id}>
                      <td>{link(t.title === t.id ? t.id : `${t.id} ${t.title}`, () => onOpenTask(t.id))}</td>
                      <td className="r">{t.round > 0 ? t.round : '–'}</td>
                      <td className="r">{t.round > 0 || t.rejects > 0 ? t.rejects : '–'}</td>
                      <td><span className={`mk ${tone}`}>{needs ? '사람 필요' : STATUS_TEXT[t.status]}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        <h3>토큰은 어디에 썼나</h3>
        {v.tokens.length === 0
          ? <p className="paper-empty">아직 기록된 토큰이 없습니다</p>
          : (
            <table>
              <thead><tr><th>역할</th><th className="r">토큰</th><th className="r">캐시</th></tr></thead>
              <tbody>
                {v.tokens.map((t) => (
                  <tr key={t.role}><td><span className="mono">{t.provider}</span> {ROLE_TEXT[t.role] ?? t.role}</td><td className="r">{num(t.tokens)}</td><td className="r">{`${t.cachedPct}%`}</td></tr>
                ))}
              </tbody>
            </table>
          )}
      </aside>
    </section>
  )
}
