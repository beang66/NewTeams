import type { AttentionItem } from './attention'
import { reasonLabel } from './labels'

/** 결정 큐 한 줄: 왜 멈췄나, 무엇을 고르면 되나, 고르면 무슨 일이 생기나. */
export interface Decision {
  key: string
  /** 'start'는 사람이 파이프라인을 시작해야 하는 자리(주의 항목이 아님). */
  item: AttentionItem | { kind: 'start' }
  title: string
  task?: string
  why: string
  choose: string
  outcome: string
  since?: string
}

const GUIDE: Record<string, { why: string; choose: string; outcome: string }> = {
  repeat_finding: { why: '검수에서 같은 지적이 반복됐고 마스터가 풀지 못했습니다.', choose: '고칠 방향을 지침으로 보내거나 태스크를 건너뜁니다.', outcome: '지침을 받으면 같은 태스크를 다시 고칩니다.' },
  reject_limit: { why: '반려 상한에 닿아 더 시도하지 않고 멈췄습니다.', choose: '지침을 보내거나 태스크를 건너뜁니다.', outcome: '지침을 받으면 반려 횟수를 새로 셉니다.' },
  repeat_error: { why: '같은 오류가 되풀이돼 자동 재시도를 멈췄습니다.', choose: '원인을 알려 주는 지침을 보내거나 건너뜁니다.', outcome: '지침을 받으면 다시 실행합니다.' },
  permission: { why: '에이전트에게 필요한 권한이 없습니다.', choose: '허용할지 지침으로 알려 주세요.', outcome: '지침에 따라 다시 실행합니다.' },
  merge_conflict: { why: '통합 중 병합 충돌을 자동으로 풀지 못했습니다.', choose: '어느 쪽을 남길지 지침을 보내거나 건너뜁니다.', outcome: '지침을 받으면 병합을 다시 시도합니다.' },
  rate_limit: { why: '모델 사용량 한도에 걸렸습니다.', choose: '한도가 풀린 뒤 재개하거나 지침을 보냅니다.', outcome: '멈춘 단계부터 이어서 실행합니다.' },
  openai_cap: { why: 'OpenAI 지출이 설정한 상한에 닿았습니다.', choose: '상한을 확인하고 재개합니다.', outcome: '검수를 이어서 실행합니다.' },
  workflow_error: { why: '워크플로가 예상하지 못한 오류로 멈췄습니다.', choose: '원본 로그를 보고 지침을 보냅니다.', outcome: '지침에 따라 다시 시도합니다.' },
}

export function decisionsOf(items: AttentionItem[], idle?: 'not_started' | 'stopped'): Decision[] {
  const list = items.map((item): Decision => {
    if (item.kind === 'spec') {
      return { key: 'spec', item, title: '스펙 승인', why: '마스터가 스펙 초안을 마쳤습니다.', choose: '스펙을 읽고 승인하거나 고칠 점을 말합니다.', outcome: '승인한 뒤 [파이프라인 시작]을 눌러야 실행됩니다.' }
    }
    if (item.kind === 'login') {
      return { key: item.eventId, item, since: item.since, title: '다시 로그인', why: 'Claude 또는 Codex 로그인이 만료됐습니다.', choose: '터미널에서 다시 로그인한 뒤 재개합니다.', outcome: '멈춘 단계부터 이어서 실행합니다.' }
    }
    const g = GUIDE[item.reason]
    return {
      key: item.eventId, item, since: item.since, task: item.task,
      title: reasonLabel(item.reason) || '사람 확인 필요',
      why: g?.why ?? (item.detail || '에이전트가 사람의 판단을 기다립니다.'),
      choose: g?.choose ?? '지침을 보내거나 태스크를 건너뜁니다.',
      outcome: g?.outcome ?? '지침에 따라 이어서 실행합니다.',
    }
  })
  if (idle) list.unshift(idle === 'stopped'
    ? { key: 'start', item: { kind: 'start' }, title: '다시 시작', why: '사람이 파이프라인을 정지했습니다.', choose: '준비되면 다시 시작합니다.', outcome: '멈춘 단계부터 이어서 실행합니다.' }
    : { key: 'start', item: { kind: 'start' }, title: '파이프라인 시작', why: '스펙이 승인됐고 사람의 시작을 기다립니다.', choose: '시작을 눌러 시드·기획·개발을 돌립니다.', outcome: '에이전트가 실제 Claude·GPT를 호출하기 시작합니다.' })
  // 오래 기다린 것부터. 시각이 없는 스펙 승인은 맨 앞(파이프라인 전체가 기다린다).
  return list.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))
}

/** "3분째", "2시간째", "1일째" */
export function waited(since: string | undefined, now: Date): string {
  if (!since) return ''
  const min = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000))
  if (min < 1) return '방금'
  if (min < 60) return `${min}분째`
  if (min < 1440) return `${Math.floor(min / 60)}시간째`
  return `${Math.floor(min / 1440)}일째`
}
