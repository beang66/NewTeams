import type { ReactNode } from 'react'
import { SectionIcon } from './SectionIcons'

/** 홈 카드의 공통 틀: 위쪽 포인트색 선 + 아이콘·제목·보조 정보 줄. */
export function Section({ id, title, meta, area, action, children }: { id?: string; title: string; meta?: ReactNode; area: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className={`hs ha-${area}`} aria-label={title}>
      <header className="hs-head">
        <span className="hs-icon" aria-hidden="true"><SectionIcon name={area} /></span>
        <h2>{title}</h2>
        {meta !== undefined && <span className="hs-meta">{meta}</span>}
        {action}
      </header>
      {children}
    </section>
  )
}
