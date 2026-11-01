import { expect, test } from '@playwright/test'
import { mockApi } from './mockApi'

// Mobile project (390x844): S2 on a phone — chronological list, no horizontal scroll, attention card reachable.

test('모바일: 시간순 목록, 가로 스크롤 없음, 주의 카드까지 닿는다', async ({ page }) => {
  const mock = await mockApi(page, 'deadlock')
  await page.goto('/#/run')

  await expect(page.getByRole('list', { name: '이벤트 목록' })).toBeVisible()
  await expect(page.locator('.lane-svg')).toHaveCount(0) // 768px 이하는 레인 대신 목록
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // 주의 1 → 서랍이 열리고 카드의 지침 전송과 근거 진입점이 보인다
  const attention = page.getByRole('button', { name: '주의 1', exact: true })
  await expect(attention).toBeVisible()
  await expect(attention).toBeInViewport()
  await attention.click()
  const drawer = page.getByRole('complementary', { name: '오른쪽 패널' })
  await expect(drawer).toBeVisible()
  const card = drawer.locator('.acard')
  await expect(card.getByRole('heading', { name: /t3 · 같은 지적 반복/ })).toBeVisible()
  await expect(card.getByRole('button', { name: '근거 보기' })).toBeInViewport()
  await card.getByRole('button', { name: '지침 보내기' }).scrollIntoViewIfNeeded()
  await expect(card.getByRole('button', { name: '지침 보내기' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // 목록에서 이벤트를 고르면 상세(원본)가 열린다
  await drawer.getByRole('button', { name: '패널 닫기' }).click()
  await page.getByRole('list', { name: '이벤트 목록' }).getByRole('button', { name: new RegExp(mock.fixture.ids.human!) }).click()
  await expect(drawer.getByRole('tab', { name: '상세' })).toHaveAttribute('aria-selected', 'true')
})
