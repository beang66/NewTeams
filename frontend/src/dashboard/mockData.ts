// 대시보드 목업 데이터. 2단계(DB·API)에서 `/dashboard` 응답으로 교체한다.
// 값이 없는 지표는 0이 아니라 null로 둔다(데이터 누락을 0으로 표현하지 않는다).

export type ChannelKey = "youtube" | "instagram" | "threads" | "wordpress";

export interface Goal {
  id: string;
  title: string;
  metric: string;
  current: number | null;
  target: number;
  unit: string;
  due: string;
}

export interface TodayTask {
  id: string;
  title: string;
  project: string;
  due: string;
  done: boolean;
}

export interface ChannelSummary {
  key: ChannelKey;
  label: string;
  metricLabel: string;
  value: number | null;
  delta: number | null;
  status: "connected" | "not_connected" | "error";
  updatedAt: string | null;
}

export interface Output {
  id: string;
  title: string;
  kind: string;
  at: string;
}

export interface Approval {
  id: string;
  title: string;
  channel: string;
  requestedAt: string;
}

export interface Failure {
  id: string;
  title: string;
  reason: string;
  action: string;
}

export interface Routine {
  id: string;
  name: string;
  schedule: string;
  nextRun: string;
  lastResult: "ok" | "failed" | "none";
}

export interface Skill {
  id: string;
  name: string;
  description: string;
}

export interface EventItem {
  id: string;
  text: string;
  at: string;
}

export interface BrainCluster {
  key: string;
  label: string;
  count: number;
}

export interface WeekDay {
  label: string;
  planned: number;
  done: number;
  failed: number;
  tokens: number;
}

export const goals: Goal[] = [
  { id: "g1", title: "WordPress 사이트 오픈", metric: "공개 페이지", current: 2, target: 5, unit: "개", due: "11/30" },
  { id: "g2", title: "YouTube 롱폼 발행", metric: "발행 영상", current: 1, target: 4, unit: "편", due: "12/31" },
  { id: "g3", title: "Threads 팔로워", metric: "팔로워", current: null, target: 300, unit: "명", due: "12/31" },
];

export const todayTasks: TodayTask[] = [
  { id: "t1", title: "홈페이지 소개 페이지 초안 검토", project: "WordPress", due: "10:00", done: true },
  { id: "t2", title: "SQLD 2과목 오답 정리", project: "SQLD", due: "14:00", done: false },
  { id: "t3", title: "주간 콘텐츠 제안 승인", project: "콘텐츠", due: "18:00", done: false },
];

export const week: WeekDay[] = [
  { label: "월", planned: 3, done: 3, failed: 0, tokens: 41200 },
  { label: "화", planned: 4, done: 3, failed: 1, tokens: 58800 },
  { label: "수", planned: 2, done: 2, failed: 0, tokens: 22100 },
  { label: "목", planned: 5, done: 4, failed: 0, tokens: 73400 },
  { label: "금", planned: 3, done: 1, failed: 0, tokens: 19600 },
  { label: "토", planned: 1, done: 0, failed: 0, tokens: 0 },
  { label: "일", planned: 0, done: 0, failed: 0, tokens: 0 },
];

export const channels: ChannelSummary[] = [
  { key: "wordpress", label: "WordPress", metricLabel: "방문", value: 412, delta: 38, status: "connected", updatedAt: "07:30" },
  { key: "youtube", label: "YouTube", metricLabel: "조회수", value: 1830, delta: 120, status: "connected", updatedAt: "07:30" },
  { key: "instagram", label: "Instagram", metricLabel: "팔로워", value: null, delta: null, status: "not_connected", updatedAt: null },
  { key: "threads", label: "Threads", metricLabel: "팔로워", value: null, delta: null, status: "error", updatedAt: "어제 22:10" },
];

export const outputs: Output[] = [
  { id: "o1", title: "홈페이지 소개 페이지 v2", kind: "WordPress 페이지", at: "09:12" },
  { id: "o2", title: "10월 마지막 주 회고", kind: "Obsidian AI Inbox", at: "어제" },
  { id: "o3", title: "롱폼 #2 대본 초안", kind: "YouTube 대본", at: "10/30" },
];

export const approvals: Approval[] = [
  { id: "a1", title: "블로그 글: AI 에이전트로 1인 업무 자동화", channel: "WordPress", requestedAt: "08:40" },
  { id: "a2", title: "주간 콘텐츠 제안 5건", channel: "콘텐츠", requestedAt: "07:00" },
];

export const failures: Failure[] = [
  { id: "f1", title: "Threads 연결 만료", reason: "토큰 갱신 실패", action: "재연결" },
];

export const routines: Routine[] = [
  { id: "r1", name: "아침 채널 지표 수집", schedule: "매일 07:30", nextRun: "내일 07:30", lastResult: "ok" },
  { id: "r2", name: "오늘 작업 브리핑", schedule: "매일 08:00", nextRun: "내일 08:00", lastResult: "ok" },
  { id: "r3", name: "주간 콘텐츠 제안", schedule: "매주 월 07:00", nextRun: "11/3 07:00", lastResult: "failed" },
];

export const skills: Skill[] = [
  { id: "s1", name: "채널별 초안 변환", description: "하나의 기획을 채널 형식으로" },
  { id: "s2", name: "브랜드 톤 점검", description: "금지 표현·톤 검사" },
  { id: "s3", name: "지식 요약", description: "선택 노트 요약 → AI Inbox" },
];

export const events: EventItem[] = [
  { id: "e1", text: "홈페이지 소개 페이지 v2 생성 완료", at: "09:12" },
  { id: "e2", text: "아침 채널 지표 수집 완료", at: "07:31" },
  { id: "e3", text: "Threads 토큰 갱신 실패", at: "어제 22:10" },
];

// 세컨드 브레인: Obsidian 검색 허용 범위(01 Projects/, wiki/)의 분류별 노트 수
export const brain: BrainCluster[] = [
  { key: "projects", label: "프로젝트", count: 184 },
  { key: "concepts", label: "개념", count: 96 },
  { key: "sources", label: "출처", count: 142 },
  { key: "entities", label: "엔티티", count: 58 },
  { key: "questions", label: "질문", count: 21 },
  { key: "inbox", label: "AI Inbox", count: 33 },
];

export const sync = { saved: "클라우드 저장됨", obsidianLastSync: "07:52" };
export const usage = { monthCostKrw: 12400, monthCapKrw: 50000 };
