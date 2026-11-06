import { readFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { expect } from './fixtures'

export type Forecast = {
  match_id: string; sport: 'football' | 'valorant'; team_a: string; team_b: string
  probabilities: { a: number; b: number; draw?: number }
}
export const forecasts: Forecast[] = JSON.parse(readFileSync(new URL('../../src/arena_copilot/showcase/predictions.json', import.meta.url), 'utf8'))

export async function navigate(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  // A transformed off-canvas drawer is still CSS-visible. Use the mobile
  // affordance the user can actually reach, rather than visibility alone.
  const menu = page.getByRole('button', { name: 'Open navigation menu' })
  const mobile = await menu.isVisible()
  if (mobile) await menu.click()
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*AI)?$`) }).click()
  if (mobile) await expect(nav).not.toBeVisible()
}

export async function expectForecast(page: Page, forecast: Forecast) {
  await page.getByRole('button', { name: `Inspect forecast ${forecast.team_a} vs ${forecast.team_b}`, exact: true }).click()
  const detail = page.getByRole('region', { name: 'Forecast details' })
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const expected = `${forecast.team_a} ${pct(forecast.probabilities.a)}${forecast.probabilities.draw !== undefined ? `, draw ${pct(forecast.probabilities.draw)}` : ''}, ${forecast.team_b} ${pct(forecast.probabilities.b)}`
  await expect(detail.getByRole('img', { name: expected, exact: true })).toBeVisible()
  await expect(detail.getByText(forecast.match_id, { exact: true })).toBeVisible()
  await expect(detail.getByText('Draw', { exact: true })).toHaveCount(forecast.sport === 'football' ? 1 : 0)
}

export async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
    message: 'The document must fit the viewport; tables may scroll inside their containers',
  }).toBeLessThanOrEqual(1)
}

export async function capture(page: Page, testInfo: TestInfo, filename: string, fullPage = true) {
  if (testInfo.repeatEachIndex > 0) return
  const path = testInfo.outputPath(filename)
  await page.screenshot({ path, fullPage, animations: 'disabled' })
  await testInfo.attach(filename, { path, contentType: 'image/png' })
}
