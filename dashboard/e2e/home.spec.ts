import { expect, test } from '@playwright/test'
import { mockApi } from './mockApi'

// 통합 홈: 내 차례 · 진행 중 실행 · 세컨드 브레인이 보이고, 실행 관제로 오가며, 모바일에서 가로 스크롤이 없다.

test('홈: 내 차례와 진행 중 실행에서 관제로 이동하고 돌아온다', async ({ page }) => {
  await mockApi(page, 'build')
  await page.goto('/')
  await expect(page.getByRole('region', { name: '내 차례' })).toBeVisible()
  await expect(page.getByRole('region', { name: '세컨드 브레인' })).toBeVisible()
  await expect(page.getByText('목업 데이터')).toBeVisible()

  await page.getByRole('group', { name: '분류로 강조' }).getByRole('button', { name: /프로젝트 184/ }).click()
  await expect(page.getByRole('button', { name: '프로젝트 184개' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '스킬' }).getByRole('listitem')).toHaveCount(4) // 한 쪽에 4개
  await page.getByRole('button', { name: '2쪽' }).click()
  await expect(page.getByRole('region', { name: '스킬' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('region', { name: '다른 대시보드' })).toContainText('아이디어 패드')

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

test('홈: 스킬 옵션에서 모델·effort를 고르고 프롬프트를 저장하면 카드에 남는다', async ({ page }) => {
  await mockApi(page, 'build')
  await page.goto('/')
  const skills = page.getByRole('region', { name: '스킬' })
  await skills.getByRole('button', { name: /blog-draft 옵션/ }).click()
  const dialog = page.getByRole('dialog', { name: '프롬프트 · 실행 설정' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: 'Opus · effort high' }).check()
  await dialog.getByLabel('프롬프트').fill('테스트 프롬프트')
  await expect(dialog.getByText('8 / 10,000')).toBeVisible()
  await dialog.getByRole('button', { name: '저장' }).click()
  await expect(dialog).toBeHidden()
  await expect(skills.getByRole('button', { name: 'blog-draft 옵션: Opus · high' })).toBeVisible()

  await page.reload()
  await skills.getByRole('button', { name: /blog-draft 옵션/ }).click()
  await expect(dialog.getByRole('radio', { name: 'Opus · effort high' })).toBeChecked()
  await expect(dialog.getByLabel('프롬프트')).toHaveValue('테스트 프롬프트')
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toBeHidden()
})

test('홈: 상단의 알림·설정·메시지 패널이 열리고 Esc로 닫힌다', async ({ page }) => {
  await mockApi(page, 'build')
  await page.goto('/')
  await expect(page.locator('time.ht-clock')).toContainText(/\d{2}:\d{2}/)
  await page.getByRole('button', { name: /^알림/ }).click()
  await expect(page.getByRole('dialog', { name: '알림' })).toContainText('홈 대시보드 t3 교착')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '알림' })).toBeHidden()
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '설정' })).toContainText('역할별 모델')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '메시지 · 마스터에게 묻기' }).click()
  await expect(page.getByRole('dialog', { name: '메시지 · 마스터에게 묻기' }).getByLabel('마스터에게 보낼 질문')).toBeVisible()
})
