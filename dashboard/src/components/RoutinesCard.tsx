import { useEffect, useState } from 'react'
import { api, type InstalledSkill, type Routine, type RoutineInput } from '../api/client'
import { nextDue } from '@orch/skills/schedule'
import { clockHM } from '../model/time'
import { Section } from './HomeSection'
import { CLAUDE_MODELS, EFFORTS } from './SkillOptions'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const BLANK: RoutineInput = { name: '', skill: '', input: '', model: '기본 모델', effort: '기본', enabled: true, schedule: { kind: 'daily', time: '07:30' } }
const dateTime = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function scheduleText(s: RoutineInput['schedule']): string {
  return s.kind === 'daily' ? `매일 ${s.time}` : `매주 ${(s.days ?? []).slice().sort().map((d) => DAYS[d]).join('·') || '(요일 없음)'} ${s.time}`
}

/** 루틴: 정한 시각에 스킬을 실행한다. 오케스트레이터가 켜져 있을 때만 돈다(놓친 실행은 켜질 때 한 번 따라잡음). */
export function RoutinesCard() {
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [form, setForm] = useState<{ id?: string; value: RoutineInput } | null>(null)
  const [err, setErr] = useState<string>()
  const load = () => api.routines().then(setRoutines).catch((e: unknown) => { setRoutines([]); setErr(errText(e)) })
  useEffect(() => {
    void load()
    api.skills().then(setSkills).catch(() => undefined)
    const t = setInterval(() => { void load() }, 30_000) // 루틴이 돌면 최근 실행이 바뀐다
    return () => clearInterval(t)
  }, [])

  const save = async (value: RoutineInput) => {
    try {
      await api.saveRoutine(value, form?.id)
      setForm(null); setErr(undefined); await load()
    } catch (e) { setErr(errText(e)) }
  }
  const remove = async (r: Routine) => {
    if (!window.confirm(`루틴 ‘${r.name}’을(를) 지울까요? 실행 기록은 남습니다.`)) return
    try { await api.deleteRoutine(r.id); await load() } catch (e) { setErr(errText(e)) }
  }
  const toggle = async (r: Routine) => {
    try {
      await api.saveRoutine({ name: r.name, skill: r.skill, input: r.input, model: r.model, effort: r.effort, enabled: !r.enabled, schedule: r.schedule }, r.id)
      await load()
    } catch (e) { setErr(errText(e)) }
  }

  const now = new Date()
  return (
    <Section area="routines" title="루틴" meta="오케스트레이터가 켜져 있을 때"
      action={!form && <button type="button" className="btn" onClick={() => setForm({ value: { ...BLANK } })}>+ 루틴</button>}>
      {form && <RoutineForm skills={skills} initial={form.value} editing={!!form.id} onSave={(v) => void save(v)} onCancel={() => setForm(null)} />}
      {err && <p className="acard-error" role="alert">{err}</p>}
      <ul className="hs-list">
        {routines?.map((r) => {
          const next = r.enabled ? nextDue(r.schedule, now) : null
          return (
            <li key={r.id} className="hs-routine">
              <span className="hs-routine-head"><strong>{r.name}</strong><span className={`hs-badge${r.enabled ? ' is-on' : ''}`}>{r.enabled ? '켜짐' : '꺼짐'}</span></span>
              <small className="hs-routine-when">{scheduleText(r.schedule)} · {r.skill}</small>
              <small className="hs-last">
                최근 {r.lastRunAt ? dateTime.format(new Date(r.lastRunAt)) : '없음'}{r.lastError ? <b> · ✕ {r.lastError}</b> : ''}
                {next ? ` · 다음 ${dateTime.format(next)}` : ''}
              </small>
              <span className="hs-routine-actions">
                <button type="button" className="btn" onClick={() => void toggle(r)}>{r.enabled ? '끄기' : '다시 켜기'}</button>
                <button type="button" className="btn" onClick={() => setForm({ id: r.id, value: { name: r.name, skill: r.skill, input: r.input, model: r.model, effort: r.effort, enabled: r.enabled, schedule: r.schedule } })}>고치기</button>
                <button type="button" className="btn is-danger" onClick={() => void remove(r)}>삭제</button>
              </span>
            </li>
          )
        })}
        {routines?.length === 0 && !form && <li className="hs-meta">루틴이 없습니다. ‘+ 루틴’으로 정한 시각에 스킬을 실행하게 할 수 있습니다.</li>}
      </ul>
    </Section>
  )
}

function RoutineForm({ skills, initial, editing, onSave, onCancel }: { skills: InstalledSkill[]; initial: RoutineInput; editing: boolean; onSave: (v: RoutineInput) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial)
  const set = <K extends keyof RoutineInput>(k: K, value: RoutineInput[K]) => setV((o) => ({ ...o, [k]: value }))
  const s = v.schedule
  const days = s.days ?? []
  const invalid = !v.name.trim() || !v.skill || (s.kind === 'weekly' && days.length === 0)
  return (
    <form className="hs-routine-form" onSubmit={(e) => { e.preventDefault(); if (!invalid) onSave({ ...v, name: v.name.trim(), schedule: s.kind === 'daily' ? { kind: 'daily', time: s.time } : s }) }}>
      <label className="field"><span className="field-label">이름</span>
        <input name="routine-name" autoComplete="off" required maxLength={100} value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 아침 브리핑…" /></label>
      <label className="field"><span className="field-label">실행할 스킬</span>
        <select value={v.skill} onChange={(e) => set('skill', e.target.value)} required>
          <option value="">선택 없음</option>
          {v.skill && !skills.some((x) => x.name === v.skill) && <option value={v.skill}>{v.skill}</option>}
          {skills.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select></label>
      <label className="field"><span className="field-label">입력(프롬프트)</span>
        <textarea rows={2} maxLength={10_000} value={v.input} onChange={(e) => set('input', e.target.value)} placeholder="스킬에 줄 지시…" /></label>
      <span className="hs-row">
        <label className="field"><span className="field-label">모델</span>
          <select value={v.model} onChange={(e) => set('model', e.target.value)}>{CLAUDE_MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="field"><span className="field-label">effort</span>
          <select value={v.effort} onChange={(e) => set('effort', e.target.value)}>{EFFORTS.map((m) => <option key={m}>{m}</option>)}</select></label>
      </span>
      <fieldset className="field">
        <legend className="field-label">일정</legend>
        <span className="hs-row">
          <label><input type="radio" name="kind" checked={s.kind === 'daily'} onChange={() => set('schedule', { ...s, kind: 'daily' })} /> 매일</label>
          <label><input type="radio" name="kind" checked={s.kind === 'weekly'} onChange={() => set('schedule', { ...s, kind: 'weekly', days: days.length ? days : [1] })} /> 매주</label>
          <label>시각 <input type="time" required value={s.time} onChange={(e) => set('schedule', { ...s, time: e.target.value })} /></label>
        </span>
        {s.kind === 'weekly' && (
          <span className="hs-row" role="group" aria-label="요일">
            {DAYS.map((d, i) => (
              <label key={d}><input type="checkbox" checked={days.includes(i)} onChange={(e) => set('schedule', { ...s, days: e.target.checked ? [...days, i] : days.filter((x) => x !== i) })} /> {d}</label>
            ))}
          </span>
        )}
      </fieldset>
      <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} /> <span>켜기</span></label>
      <p className="hs-meta">파일을 만드는 스킬은 루틴으로 돌아도 ‘승인 대기’로 멈춥니다. 스킬 카드의 실행 기록에서 승인하세요. 지금 시각 {clockHM(new Date())}.</p>
      <span className="hs-row">
        <button type="submit" className="btn is-primary" disabled={invalid}>{editing ? '저장' : '만들기'}</button>
        <button type="button" className="btn" onClick={onCancel}>취소</button>
      </span>
    </form>
  )
}
