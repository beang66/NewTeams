import { useEffect, useRef, useState } from 'react'
import { applyEvent, initialState, type RunState } from '@orch/store/state'
import type { Envelope } from '@orch/protocol/messages'
import type { Plan } from '@orch/protocol/plan'
import { api, type AgentConfig } from './client'

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
const idNum = (id: string): bigint => BigInt(id.slice(4))

export function useRun(opts: { eventSourceFactory?: (url: string) => EventSource } = {}): RunView {
  const factoryRef = useRef(opts.eventSourceFactory)
  const [view, setView] = useState<RunView>({
    state: initialState, events: [], plan: null, agents: null, connected: false, loading: true,
  })

  useEffect(() => {
    let disposed = false
    let ready = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let state = initialState
    let events: Envelope[] = []
    const seen = new Set<string>()
    const buffer: Envelope[] = []
    const patch = (p: Partial<RunView>) => { if (!disposed) setView((v) => ({ ...v, ...p })) }

    const refetchPlan = () => { api.plan().then((plan) => patch({ plan }), () => undefined) }

    const ingest = (e: Envelope) => {
      if (seen.has(e.id)) return
      seen.add(e.id)
      const hadTask = !e.task || e.task in state.tasks
      state = applyEvent(state, e)
      events = [...events, e].sort((a, b) => (idNum(a.id) < idNum(b.id) ? -1 : idNum(a.id) > idNum(b.id) ? 1 : 0))
      patch({ state, events })
      const payload = e.payload as { stage?: unknown } | null
      if ((e.type === 'STATE_CHANGE' && payload && typeof payload === 'object' && payload.stage) || !hadTask) refetchPlan()
    }

    const factory = factoryRef.current
    const es = factory ? factory('/api/stream') : new EventSource('/api/stream')
    es.onopen = () => patch({ connected: true })
    es.onerror = () => patch({ connected: false })
    es.addEventListener('envelope', (m) => {
      let env: Envelope
      try { env = JSON.parse((m as MessageEvent<string>).data) as Envelope } catch { return }
      patch({ connected: true })
      if (ready) ingest(env)
      else buffer.push(env)
    })

    const load = async () => {
      try {
        const [serverState, plan, agents, initialEvents] = await Promise.all([
          api.state(), api.plan(), api.agents(), api.events(),
        ])
        if (disposed) return
        state = serverState
        events = [...initialEvents]
        for (const e of initialEvents) seen.add(e.id)
        ready = true
        const cursor = serverState.lastEventId ? idNum(serverState.lastEventId) : -1n
        patch({ state, events, plan, agents, loading: false, error: undefined })
        for (const e of buffer.splice(0)) if (idNum(e.id) > cursor) ingest(e)
      } catch {
        if (disposed) return
        patch({ loading: false, error: '서버에 연결할 수 없습니다' })
        timer = setTimeout(load, RETRY_MS)
      }
    }
    void load()

    return () => { disposed = true; if (timer) clearTimeout(timer); es.close() }
  }, [])

  return view
}
