import { useEffect, useRef, useState } from 'react'

/*
 * 스킬 옵션: 모델 × effort 격자에서 하나를 고르고 프롬프트를 적는다(참고 이미지의 '프롬프트 · 실행 설정').
 * 값은 이 기기에 스킬별로 저장하고, 새 작업부터 적용한다. 실행 에이전트(Claude/Codex)는 스킬에 고정이다.
 */

export const EFFORTS = ['기본', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
export const CLAUDE_MODELS = ['기본 모델', 'Opus', 'Sonnet', 'Haiku', 'Fable'] as const
export const CODEX_MODELS = ['기본 모델'] as const
export const PROMPT_MAX = 10_000

export interface SkillOption { model: string; effort: Effort; prompt: string }
export const DEFAULT_OPTION: SkillOption = { model: '기본 모델', effort: '기본', prompt: '' }

const key = (id: string) => `newteam.skill-option.${id}`

export function loadOption(id: string): SkillOption {
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return DEFAULT_OPTION
    const v = JSON.parse(raw) as Partial<SkillOption>
    return {
      model: typeof v.model === 'string' ? v.model : DEFAULT_OPTION.model,
      effort: (EFFORTS as readonly string[]).includes(v.effort ?? '') ? (v.effort as Effort) : '기본',
      prompt: typeof v.prompt === 'string' ? v.prompt.slice(0, PROMPT_MAX) : '',
    }
  } catch { return DEFAULT_OPTION }
}

export function saveOption(id: string, v: SkillOption): void {
  try { localStorage.setItem(key(id), JSON.stringify(v)) } catch { /* 저장 불가 브라우저 */ }
}

export function optionSummary(v: SkillOption): string {
  const parts = [v.model === '기본 모델' ? '' : v.model, v.effort === '기본' ? '' : v.effort].filter(Boolean)
  return parts.length ? parts.join(' · ') : '기본 설정'
}

interface Props {
  skill: { id: string; name: string; maker: string; placeholder?: string }
  /** 팝오버를 붙일 '옵션' 버튼 */
  anchor: HTMLElement
  onClose: () => void
  onSaved: (v: SkillOption) => void
}

export function SkillOptionsDialog({ skill, anchor, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const models = skill.maker === 'Claude' ? CLAUDE_MODELS : CODEX_MODELS
  const initial = loadOption(skill.id)
  const [model, setModel] = useState(models.includes(initial.model as never) ? initial.model : '기본 모델')
  const [effort, setEffort] = useState<Effort>(initial.effort)
  const [prompt, setPrompt] = useState(initial.prompt)
  // 작성 중 프롬프트는 닫았다 열어도 남도록 바로바로 초안으로 보관한다.
  const draftKey = `${key(skill.id)}.draft`
  useEffect(() => {
    try { const d = localStorage.getItem(draftKey); if (d !== null) setPrompt(d.slice(0, PROMPT_MAX)) } catch { /* 없음 */ }
    const el = ref.current
    if (!el) return
    // 옵션 버튼 아래(공간이 모자라면 위)에 붙이고, 화면 밖으로 나가지 않게 가로 위치를 자른다.
    el.showPopover()
    const a = anchor.getBoundingClientRect()
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8
    const below = a.bottom + gap + h <= window.innerHeight
    el.style.top = `${Math.max(gap, below ? a.bottom + gap : a.top - gap - h)}px`
    el.style.left = `${Math.min(Math.max(gap, a.right - w), window.innerWidth - w - gap)}px`
    // 옵션 버튼이 있는 모서리에서 커지게 한다.
    el.style.transformOrigin = below ? 'top right' : 'bottom right'
  }, [draftKey, anchor])
  useEffect(() => { try { localStorage.setItem(draftKey, prompt) } catch { /* 없음 */ } }, [draftKey, prompt])

  const save = () => {
    const v = { model, effort, prompt: prompt.slice(0, PROMPT_MAX) }
    saveOption(skill.id, v)
    try { localStorage.removeItem(draftKey) } catch { /* 없음 */ }
    onSaved(v)
    ref.current?.hidePopover()
  }
  const cancel = () => {
    try { localStorage.removeItem(draftKey) } catch { /* 없음 */ }
    ref.current?.hidePopover()
  }

  return (
    <div ref={ref} popover="auto" role="dialog" className="so" aria-labelledby="so-title"
      onToggle={(e) => { if ((e as unknown as ToggleEvent).newState === 'closed') { anchor.focus(); onClose() } }}>
      <form className="so-body" onSubmit={(e) => { e.preventDefault(); save() }}>
        <header className="so-head">
          <h2 id="so-title">프롬프트 · 실행 설정</h2>
          <span className="mono so-skill">{skill.name}</span>
        </header>
        <p className="so-sub">실행 에이전트: <strong>{skill.maker}</strong> · 스킬에 고정됩니다.</p>

        <fieldset className="so-grid-wrap">
          <legend className="sr-only">모델과 effort</legend>
          <table className="so-grid">
            <thead>
              <tr><th scope="col"><span className="sr-only">모델</span></th>{EFFORTS.map((e) => <th key={e} scope="col">{e}</th>)}</tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m} className={m === model ? 'is-row' : ''}>
                  <th scope="row">{m}</th>
                  {EFFORTS.map((e) => {
                    const on = m === model && e === effort
                    return (
                      <td key={e}>
                        <label className={`so-cell${on ? ' is-on' : ''}`}>
                          <input type="radio" name="model-effort" checked={on} onChange={() => { setModel(m); setEffort(e) }} aria-label={`${m} · effort ${e}`} />
                          <span aria-hidden="true" />
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {skill.maker !== 'Claude' && <p className="so-hint">Codex 모델은 설정 파일의 검수 모델을 따릅니다.</p>}
        </fieldset>

        <div className="so-prompt">
          <label htmlFor="so-text"><strong>프롬프트</strong></label>
          <span className="mono" aria-live="polite">{nfmt(prompt.length)} / {nfmt(PROMPT_MAX)}</span>
        </div>
        <textarea id="so-text" value={prompt} maxLength={PROMPT_MAX} rows={5}
          placeholder={`${skill.placeholder ?? '이 스킬에 줄 지시를 적어 주세요'}…`} onChange={(e) => setPrompt(e.target.value)} />
        <p className="so-hint">새 작업부터 적용됩니다. 이미 시작한 작업은 시작할 때의 설정으로 이어지고, 높은 effort는 시간과 사용량이 늘어날 수 있어요.</p>

        <footer className="so-foot">
          <button type="button" className="btn so-cancel" onClick={cancel}>취소</button>
          <button type="submit" className="btn is-primary so-save">저장</button>
        </footer>
      </form>
    </div>
  )
}

const nf = new Intl.NumberFormat('ko-KR')
const nfmt = (n: number) => nf.format(n)
