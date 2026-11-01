// 홈 대시보드 목업. 오케스트레이터에 홈 API(`/api/home`)가 생기면 교체한다.
// 실제 실행 데이터가 아니다. 값이 없는 지표는 0이 아니라 null로 둔다.
import type { Stage } from '@orch/store/state'

export interface MyTurn {
  id: string
  kind: 'spec' | 'deadlock' | 'publish'
  title: string
  detail: string
  at: string
  href: string
}
export interface ActiveRun {
  id: string
  project: string
  title: string
  stage: Stage
  note: string
}
export interface Goal { id: string; title: string; metric: string; current: number | null; target: number; unit: string; due: string }
export interface TodayTask { id: string; title: string; project: string; due: string; done: boolean }
export interface WeekDay { label: string; planned: number; done: number; failed: number; tokens: number }
export interface Channel { key: string; label: string; metric: string; value: number | null; delta: number | null; status: 'connected' | 'not_connected' | 'error'; updatedAt: string | null }
export interface QuickStart { id: string; title: string; desc: string; pack: string }
export interface Routine { id: string; name: string; schedule: string; nextRun: string; last: 'ok' | 'failed' | 'none' }
export interface Output { id: string; title: string; kind: string; at: string; evidence: string }
export interface BrainCluster { key: string; label: string; count: number }

export const projects = ['NEWTEAMs 대시보드', 'WordPress 사이트', 'SQLD']

export const myTurn: MyTurn[] = [
  { id: 'm1', kind: 'spec', title: 'WordPress 소개 페이지 스펙 승인', detail: '수용 기준 4개 · 초안 준비됨', at: '09:05', href: '#/run' },
  { id: 'm2', kind: 'deadlock', title: '홈 대시보드 t3 교착', detail: '같은 지적 2회 반복 · 마스터 해결 실패', at: '08:52', href: '#/run' },
  { id: 'm3', kind: 'publish', title: '블로그 글: AI 에이전트로 1인 업무 자동화', detail: 'WordPress · 게시 승인', at: '08:40', href: '#/run' },
]

export const activeRuns: ActiveRun[] = [
  { id: 'r1', project: 'NEWTEAMs 대시보드', title: '홈 화면 통합', stage: 'BUILD', note: '태스크 5개 중 2개 승인 · 병렬 3' },
  { id: 'r2', project: 'WordPress 사이트', title: '소개 페이지 작성', stage: 'INTAKE', note: '요구사항 정리 끝 · 스펙 승인 대기' },
]

export const quickStarts: QuickStart[] = [
  { id: 'q1', title: '블로그 글 초안', desc: '주제 → 개요 → 초안 → 브랜드 톤 검수', pack: '콘텐츠' },
  { id: 'q2', title: '채널별 변환', desc: '하나의 글을 YouTube·Instagram·Threads 형식으로', pack: '콘텐츠' },
  { id: 'q3', title: '리서치 보고서', desc: '자료 조사 → 출처 검증 → 보고서', pack: '리서치' },
  { id: 'q4', title: '웹앱 기능 개발', desc: '요구사항 → 스펙 → 개발·QA → 보고', pack: '웹앱' },
]

export const goals: Goal[] = [
  { id: 'g1', title: 'WordPress 사이트 오픈', metric: '공개 페이지', current: 2, target: 5, unit: '개', due: '11/30' },
  { id: 'g2', title: 'YouTube 롱폼 발행', metric: '발행 영상', current: 1, target: 4, unit: '편', due: '12/31' },
  { id: 'g3', title: 'Threads 팔로워', metric: '팔로워', current: null, target: 300, unit: '명', due: '12/31' },
]

export const todayTasks: TodayTask[] = [
  { id: 't1', title: '소개 페이지 스펙 검토', project: 'WordPress', due: '10:00', done: true },
  { id: 't2', title: 'SQLD 2과목 오답 정리', project: 'SQLD', due: '14:00', done: false },
  { id: 't3', title: '주간 콘텐츠 제안 승인', project: '콘텐츠', due: '18:00', done: false },
]

export const week: WeekDay[] = [
  { label: '월', planned: 3, done: 3, failed: 0, tokens: 41200 },
  { label: '화', planned: 4, done: 3, failed: 1, tokens: 58800 },
  { label: '수', planned: 2, done: 2, failed: 0, tokens: 22100 },
  { label: '목', planned: 5, done: 4, failed: 0, tokens: 73400 },
  { label: '금', planned: 3, done: 1, failed: 0, tokens: 19600 },
  { label: '토', planned: 1, done: 0, failed: 0, tokens: 0 },
  { label: '일', planned: 0, done: 0, failed: 0, tokens: 0 },
]

export const channels: Channel[] = [
  { key: 'wordpress', label: 'WordPress', metric: '방문', value: 412, delta: 38, status: 'connected', updatedAt: '07:30' },
  { key: 'youtube', label: 'YouTube', metric: '조회수', value: 1830, delta: 120, status: 'connected', updatedAt: '07:30' },
  { key: 'instagram', label: 'Instagram', metric: '팔로워', value: null, delta: null, status: 'not_connected', updatedAt: null },
  { key: 'threads', label: 'Threads', metric: '팔로워', value: null, delta: null, status: 'error', updatedAt: '어제 22:10' },
]

export const routines: Routine[] = [
  { id: 'rt1', name: '아침 채널 지표 수집', schedule: '매일 07:30 · PC 켜져 있을 때', nextRun: '내일 07:30', last: 'ok' },
  { id: 'rt2', name: '오늘 작업 브리핑 → Telegram', schedule: '매일 08:00', nextRun: '내일 08:00', last: 'ok' },
  { id: 'rt3', name: '주간 콘텐츠 제안', schedule: '매주 월 07:00', nextRun: '11/3 07:00', last: 'failed' },
]

export const outputs: Output[] = [
  { id: 'o1', title: '소개 페이지 v2', kind: 'WordPress 페이지', at: '09:12', evidence: '검수 승인 · 캡처 2' },
  { id: 'o2', title: '10월 마지막 주 회고', kind: 'Obsidian AI Inbox', at: '어제', evidence: '출처 노트 6' },
  { id: 'o3', title: '롱폼 #2 대본 초안', kind: 'YouTube 대본', at: '10/30', evidence: '검수 대기' },
]

export const brain: BrainCluster[] = [
  { key: 'projects', label: '프로젝트', count: 184 },
  { key: 'concepts', label: '개념', count: 96 },
  { key: 'sources', label: '출처', count: 142 },
  { key: 'entities', label: '엔티티', count: 58 },
  { key: 'questions', label: '질문', count: 21 },
  { key: 'inbox', label: 'AI Inbox', count: 33 },
]

// 구독 CLI 토큰과 API 예비 지출(상한 $8, PRODUCT.md)
export const usage = { claudeTokens: 182410, gptTokens: 41006, apiSpendUsd: 0.42, apiCapUsd: 8 }
export const obsidianLastSync = '07:52'
