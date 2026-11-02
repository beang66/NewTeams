import { useEffect, useRef, useState } from 'react'
import { applyEvent, initialState, type RunState } from '@orch/store/state'
import type { Envelope } from '@orch/protocol/messages'
import type { Plan } from '@orch/protocol/plan'
import { api, scopedPath, type AgentConfig } from './client'

export interface RunView {
  state: RunState
  events: Envelope[]
  plan: Plan | null
  agents: AgentConfig | null
  connected: boolean
  loading: boolean
  error?: string
}

const RETRY_MS = 3000
const ID_RE = /^msg-\d+$/
const idNum = (id: string): bigint => BigInt(id.slice(4))
const cmp = (a: Envelope, b: Envelope): number => (idNum(a.id) < idNum(b.id) ? -1 : idNum(a.id) > idNum(b.id) ? 1 : 0)
const validId = (e: Envelope): boolean => {
  if (e && typeof e.id === 'string' && ID_RE.test(e.id)) return true
  console.warn('malformed event id, skipped', e?.id)
  return false
}

export function useRun(opts: { eventSourceFactory?: (url: string) => EventSource } = {}): RunView {
  const factoryRef = useRef(opts.eventSourceFactory)
  const [view, setView] = useState<RunView>({
    state: initialState, events: [], plan: null, agents: null, connected: false, loading: true,
  })

  useEffect(() => {
    let disposed = false
    let ready = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let esTimer: ReturnType<typeof setTimeout> | undefined
    let planSeq = 0
    let state = initialState
    let events: Envelope[] = []
    const seen = new Set<string>()
    const buffer: Envelope[] = []
    const patch = (p: Partial<RunView>) => {
      if (disposed) return
      setView((v) => ((Object.keys(p) as (keyof RunView)[]).every((k) => v[k] === p[k]) ? v : { ...v, ...p }))
    }

    const refetchPlan = () => {
      const mine = ++planSeq
      api.plan().then((plan) => { if (mine === planSeq) patch({ plan }) }, () => undefined)
    }

    const cursor = (): bigint => (state.lastEventId ? idNum(state.lastEventId) : -1n)

    // Events newer than the state cursor are folded into state; older ones only join the list.
    const ingest = (e: Envelope) => {
      if (seen.has(e.id)) return
      seen.add(e.id)
      events = [...events, e].sort(cmp)
      if (idNum(e.id) <= cursor()) { patch({ events }); return }
      const hadTask = !e.task || e.task in state.tasks
      state = applyEvent(state, e)
      patch({ state, events })
      const payload = e.payload as { stage?: unknown } | null
      if ((e.type === 'STATE_CHANGE' && payload && typeof payload === 'object' && payload.stage) || !hadTask) refetchPlan()
    }

    let es: EventSource
    const connect = () => {
      const factory = factoryRef.current
      es = factory ? factory(scopedPath('/api/stream')) : new EventSource(scopedPath('/api/stream'))
      const mine = es
      es.onopen = () => patch({ connected: true })
      es.onerror = () => {
        patch({ connected: false })
        if (mine.readyState === 2 && !disposed) {
          // browser gave up retrying (e.g. non-200 on reconnect): recreate it ourselves
          mine.close()
          clearTimeout(esTimer)
          esTimer = setTimeout(connect, RETRY_MS)
        }
      }
      es.addEventListener('envelope', (m) => {
        let env: Envelope
        try { env = JSON.parse((m as MessageEvent<string>).data) as Envelope } catch { return }
        patch({ connected: true })
        if (!validId(env)) return
        if (ready) ingest(env)
        else buffer.push(env)
      })
    }
    connect()

    const load = async () => {
      let loaded: [RunState, Plan | null, AgentConfig, Envelope[]]
      try {
        loaded = await Promise.all([api.state(), api.plan(), api.agents(), api.events()])
      } catch {
        if (disposed) return
        patch({ loading: false, error: '서버에 연결할 수 없습니다' })
        timer = setTimeout(load, RETRY_MS)
        return
      }
      if (disposed) return
      const [serverState, plan, agents, initialEvents] = loaded
      state = serverState
      const initial = initialEvents.filter(validId).sort(cmp)
      events = [...initial]
      const start = cursor()
      let folded = false
      for (const e of initial) {
        seen.add(e.id)
        if (idNum(e.id) > start) { state = applyEvent(state, e); folded = true }
      }
      ready = true
      patch({ state, events, plan, agents, loading: false, error: undefined })
      if (folded) refetchPlan()
      for (const e of buffer.splice(0)) ingest(e)
    }
    void load()

    return () => { disposed = true; clearTimeout(timer); clearTimeout(esTimer); es.close() }
  }, [])

  return view
}
