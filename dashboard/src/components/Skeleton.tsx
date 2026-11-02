/** Grey placeholder bars (no animation) shown while the first load is in flight. */
export function Skeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton-group" role="status" aria-label={label ?? '불러오는 중…'}>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" data-testid="skeleton" style={{ width: `${90 - ((i * 17) % 40)}%` }} />)}
    </div>
  )
}
