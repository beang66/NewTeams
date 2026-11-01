import { readFileSync } from 'node:fs'
import { it, expect } from 'vitest'

it('유채색은 #2779a7 하나, 나머지는 검정·흰색·무채색 회색이다', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8')
  for (const [k, v] of Object.entries({ '--c-black': '#000000', '--c-accent': '#2779a7', '--c-white': '#ffffff' }))
    expect(css).toMatch(new RegExp(`${k}:\\s*${v}\\s*;`, 'i'))
  for (const [k, v] of Object.entries({ '--bg': 'var(--c-black)', '--accent': 'var(--c-accent)', '--ink': 'var(--c-white)' }))
    expect(css).toContain(`${k}: ${v};`)
  const hexes = new Set((css.match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => h.toLowerCase()))
  const gray = (h: string) => h.slice(1, 3) === h.slice(3, 5) && h.slice(3, 5) === h.slice(5, 7)
  expect([...hexes].filter((h) => !gray(h))).toEqual(['#2779a7'])
})
it('본문 폰트는 번들된 Pretendard Variable을 가리킨다', () => {
  expect(readFileSync('src/styles/tokens.css', 'utf8')).toMatch(/--font-body:[^;]*Pretendard Variable/)
})
it('글자 크기는 고정 단계만', () => {
  const sizes = [...readFileSync('src/styles/tokens.css', 'utf8').matchAll(/--fs-(\d+):\s*(\d+)px/g)].map(m => +m[2])
  expect(sizes.sort((a, b) => a - b)).toEqual([12, 13, 14, 16, 20])
})
it('외부 URL을 불러오지 않는다', () => {
  for (const f of ['index.html', 'src/styles/tokens.css', 'src/styles/base.css']) expect(readFileSync(f, 'utf8')).not.toMatch(/https?:\/\//)
})
