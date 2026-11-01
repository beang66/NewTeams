import type { ReactNode } from 'react'

/* 홈 섹션 제목·대시보드 타일 아이콘. 상단 도구 아이콘과 같은 24px 그리드, 선 1.8. 문자 기호 대신 쓴다. */

const paths: Record<string, ReactNode> = {
  turn: <path d="M4 6h16v12H4zM4 7l8 6 8-6" />,
  runs: <path d="M8 5v14l11-7z" />,
  routines: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" />,
  skills: <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />,
  brain: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="17" r="2" /><path d="M7.8 7.6l2.9 7.7M16.6 7.4l-3.5 7.9M8 7h8" /></>,
  goals: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" /></>,
  outputs: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />,
  boards: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  brand: <path d="M12 3l8 9-8 9-8-9z" />,
  library: <path d="M4 5h6v14H4zM10 5h4v14h-4zM15.5 5.5l3.8-1 3 13.5-3.8 1z" />,
  ideas: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10.3 2.5h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9-2.6-.5v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z" /></>,
}

export function SectionIcon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}
