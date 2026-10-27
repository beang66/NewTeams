import { readFileSync } from 'node:fs'
import { it, expect } from 'vitest'

it('스펙 §7.6 색 토큰', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8')
  for (const [k, v] of Object.entries({ '--bg': '#010102', '--accent': '#5e6ad2', '--ok': '#27a644', '--bad': '#eb5757', '--warn': '#f2c94c', '--ink': '#f7f8f8' }))
    expect(css).toMatch(new RegExp(`${k}:\\s*${v}\\s*;`, 'i'))
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
