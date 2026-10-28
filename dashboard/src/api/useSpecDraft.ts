import { useCallback, useEffect, useState } from 'react'
import { api } from './client'

/** spec.draft.md while the run is in INTAKE; null when absent or unreachable. */
export function useSpecDraft(active: boolean): { draft: string | null; setDraft: (d: string | null) => void } {
  const [draft, setDraftState] = useState<string | null>(null)
  const setDraft = useCallback((d: string | null) => setDraftState(d), [])
  useEffect(() => {
    if (!active) return
    let live = true
    api.human('spec.draft.md').catch(() => null).then((d) => { if (live) setDraftState(d) })
    return () => { live = false }
  }, [active])
  return { draft, setDraft }
}

export const hasDraft = (d: string | null): boolean => d !== null && d.trim() !== ''
