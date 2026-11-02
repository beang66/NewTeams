import type { MessageType } from '@orch/protocol/messages'
import { reasonLabel as baseReasonLabel } from '@orch/render/humanRenderer'
import type { Stage } from '@orch/store/state'

export const STAGE_ORDER: Stage[] = ['INTAKE', 'SPEC_APPROVED', 'SEED', 'PLAN', 'BUILD', 'INTEGRATE', 'FINAL_QA', 'REPORT', 'DONE']

export const stageLabel: Record<Stage, string> = {
  INTAKE: '요구사항', SPEC_APPROVED: '스펙 승인', SEED: '시드', PLAN: '기획', BUILD: '개발',
  INTEGRATE: '통합', FINAL_QA: '최종 QA', REPORT: '보고', DONE: '완료',
}

const EXTRA_REASONS: Record<string, string> = { workflow_error: '워크플로 오류', openai_cap: 'OpenAI 지출 상한', merge_conflict: '병합 충돌', process_restart: '프로세스 재시작' }

export const reasonLabel = (code: string): string => {
  const base = baseReasonLabel(code)
  return base === code && Object.hasOwn(EXTRA_REASONS, code) ? EXTRA_REASONS[code]! : base
}

export const typeLabel: Record<MessageType, string> = {
  ASSIGN: '지시', REPORT: '보고', REVISION: '수정', REVIEW_REQUEST: '리뷰 요청', REJECT: '반려', APPROVE: '승인',
  ESCALATE: '마스터 호출', GUIDANCE: '지침', CHAT: '대화', STATE_CHANGE: '상태 변경',
  PAUSED: '일시정지', RESUMED: '재개', HUMAN_REQUIRED: '사람 필요',
}
