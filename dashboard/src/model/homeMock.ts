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

/* ---------- 참고 이미지 레이아웃용 추가 데이터 ---------- */

/** 캘린더: 해당 월의 날짜별 일정 수(실행 마감·콘텐츠 예약·루틴). 0은 일정 없음. */
export const calendar = {
  year: 2026,
  month: 11,
  today: 1,
  counts: { 1: 2, 3: 1, 4: 3, 6: 1, 10: 2, 11: 1, 14: 4, 18: 1, 20: 2, 24: 1, 25: 2, 28: 1 } as Record<number, number>,
  events: {
    1: [{ time: '10:00', title: 'WordPress 소개 페이지 스펙 승인', kind: '승인' }, { time: '18:00', title: '주간 콘텐츠 제안 승인', kind: '승인' }],
    14: [{ time: '09:00', title: 'SQLD 시험', kind: '일정' }],
  } as Record<number, { time: string; title: string; kind: string }[]>,
}

export interface Skill { id: string; maker: string; name: string; desc: string; state: 'input' | 'ready' }
export const skills: Skill[] = [
  { id: 's1', maker: 'Claude', name: 'blog-draft', desc: '블로그 글 초안 작성', state: 'input' },
  { id: 's2', maker: 'Claude', name: 'channel-convert', desc: '채널별 형식 변환', state: 'ready' },
  { id: 's3', maker: 'Claude', name: 'shorts-video', desc: '쇼츠 대본·음성·영상 생성', state: 'input' },
  { id: 's4', maker: 'Codex', name: 'brand-tone-check', desc: '브랜드 톤 검수', state: 'ready' },
  { id: 's5', maker: 'Claude', name: 'proposal-writer', desc: '기획서 작성', state: 'input' },
  { id: 's6', maker: 'Claude', name: 'webapp-build', desc: '웹앱 기능 개발', state: 'input' },
]
export const skillTotal = skills.length

export interface RoutineRun { id: string; name: string; platform: 'Windows'; schedule: string; last: string; result: '완료' | '실패' | '기록 없음' }
export const routineRuns: RoutineRun[] = [
  { id: 'rr1', name: '아침 채널 지표 수집', platform: 'Windows', schedule: '매일 07:30 · Windows 예약', last: '최근 11.01 07:30 · 예약', result: '완료' },
  { id: 'rr2', name: '오늘 작업 브리핑 → Telegram', platform: 'Windows', schedule: '매일 08:00 · Windows 예약', last: '최근 11.01 08:00 · 예약', result: '완료' },
  { id: 'rr3', name: '주간 콘텐츠 제안', platform: 'Windows', schedule: '매주 월 07:00 · Windows 예약', last: '최근 10.27 07:00 · 예약', result: '실패' },
  { id: 'rr4', name: '세컨드 브레인 색인 갱신', platform: 'Windows', schedule: '매일 09:00·13:00·18:00', last: '최근 11.01 09:00 · 예약', result: '완료' },
]

/** 다른 대시보드: 에셋 라이브러리와 다른 화면. count가 있으면 'N개 · 설명'으로 보인다. href가 없으면 준비 중. */
export interface Board { id: string; icon: string; title: string; count: number | null; desc: string; href: string | null }
export const boards: Board[] = [
  { id: 'brand', icon: '◆', title: '브랜드 라이브러리', count: 12, desc: '로고 · 팔레트 · 글꼴 · 톤 가이드', href: null },
  { id: 'content', icon: '▣', title: '콘텐츠 라이브러리', count: 28, desc: '레퍼런스 · 영상 소스 · 효과음 · 게시물', href: null },
  { id: 'ideas', icon: '✎', title: '아이디어 패드', count: 6, desc: '대본 · 기획 메모 · 글감', href: null },
  { id: 'run', icon: '▶', title: '실행 관제', count: null, desc: '요구사항 · 스펙 승인 · 관제 · 완료 보고', href: '#/run' },
  { id: 'calendar', icon: '◷', title: '콘텐츠·캘린더', count: null, desc: '기획→게시 상태와 일정', href: null },
  { id: 'settings', icon: '⚙', title: '작업 팩·루틴·설정', count: null, desc: '역할 · 모델 · Telegram', href: null },
]
