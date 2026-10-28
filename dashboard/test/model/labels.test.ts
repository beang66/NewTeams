import { describe, expect, it } from 'vitest'
import { STAGE_ORDER, reasonLabel, stageLabel, typeLabel } from '../../src/model/labels'

describe('labels', () => {
  it('단계 순서와 라벨', () => {
    expect(STAGE_ORDER).toHaveLength(9); expect(stageLabel.FINAL_QA).toBe('최종 QA'); expect(stageLabel.DONE).toBe('완료')
  })
  it('사유 라벨은 humanRenderer 표 + 추가분, 모르면 코드 그대로', () => {
    expect(reasonLabel('rate_limit')).toBe('사용량 한도'); expect(reasonLabel('workflow_error')).toBe('워크플로 오류')
    expect(reasonLabel('openai_cap')).toBe('OpenAI 지출 상한'); expect(reasonLabel('zzz')).toBe('zzz')
  })
  it('메시지 타입 라벨', () => { expect(typeLabel.REJECT).toBe('반려'); expect(typeLabel.ESCALATE).toBe('마스터 호출') })
})
