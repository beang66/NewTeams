import { expect, test } from '@playwright/test'
import { mockApi } from './mockApi'

// 통합 홈: 내 차례 · 진행 중 실행 · 세컨드 브레인이 보이고, 실행 관제로 오가며, 모바일에서 가로 스크롤이 없다.

test('홈: 내 차례와 진행 중 실행에서 관제로 이동하고 돌아온다', async ({ page }) => {
  await mockApi(page, 'build')
  await page.goto('/')
  await expect(page.getByRole('region', { name: '내 차례' })).toBeVisible()
  await expect(page.getByRole('region', { name: '세컨드 브레인' })).toBeVisible()
  await expect(page.getByText('목업 데이터')).toBeVisible()

  await page.getByRole('button', { name: '목록' }).click()
  await expect(page.getByRole('button', { name: /프로젝트 184/ })).toBeVisible()

  await page.getByRole('region', { name: '진행 중 실행' }).getByRole('link').first().click()
  await expect(page).toHaveURL(/#\/run$/)
  await expect(page.getByRole('heading', { name: '에이전트 관제' })).toBeVisible()
  await page.getByRole('link', { name: '홈으로' }).click()
  await expect(page.getByRole('region', { name: '내 차례' })).toBeVisible()
})

test('홈(모바일): 내 차례가 맨 위, 가로 스크롤 없음', async ({ page }) => {
  await mockApi(page, 'build')
  await page.goto('/')
  const turn = await page.getByRole('region', { name: '내 차례' }).boundingBox()
  const brain = await page.getByRole('region', { name: '세컨드 브레인' }).boundingBox()
  expect(turn && brain && turn.y < brain.y).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
