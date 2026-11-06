import { createHash } from 'node:crypto'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  knownMatches,
  manifest,
  observedFootballTable,
  preMatchReference,
} from './domain-ground-truth'
import type { MatchObservation } from './domain-ground-truth'
import { capture, navigate, noPageOverflow } from './journeys'

const allMatches = knownMatches()
const competitionId = (match: MatchObservation) =>
  `${match.sport}-${createHash('sha256').update(match.competition).digest('hex').slice(0, 16)}`
const displayDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value))
const inspectMatch = (scope: Page | Locator, match: MatchObservation) =>
  scope.getByRole('button', {
    name: `Inspect match ${match.team_a} vs ${match.team_b}, ${match.status}, ${displayDate(match.start_time)}`,
    exact: true,
  })

async function openApplication(page: Page) {
  // A relative path keeps the same journey valid at the GitHub Pages subpath.
  await page.goto('./')
  await expect(page.getByText(/^(Local workspace|Public snapshot)$/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Match center.', exact: true })).toBeVisible()
  const scheduled = allMatches.filter(
    (m) => m.sport === 'football' && m.status === 'scheduled',
  ).length
  await expect(page.getByText(`${scheduled} matching matches`, { exact: true })).toBeVisible()
}

async function filterExactMatch(page: Page, match: MatchObservation) {
  await page
    .getByRole('button', {
      name: match.status === 'finished' ? 'Results' : 'Upcoming',
      exact: true,
    })
    .click()
  await page
    .getByRole('combobox', {
      name: match.sport === 'football' ? 'Filter competition' : 'Filter event',
      exact: true,
    })
    .selectOption(competitionId(match))
  await page
    .getByRole('combobox', { name: 'Filter team', exact: true })
    .selectOption({ label: match.team_a })
  await page
    .getByLabel('Match date', { exact: true })
    .fill(new Date(match.start_time).toISOString().slice(0, 10))
  const serverQuery =
    new URL(page.url()).port === '5178'
      ? page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === '/api/matches' && url.searchParams.get('search') === match.match_id
          )
        })
      : undefined
  await page.getByRole('textbox', { name: 'Search matches', exact: true }).fill(match.match_id)
  if (serverQuery) {
    const response = await serverQuery
    expect(response.ok(), 'The real server must answer the complete combined filter').toBeTruthy()
    const result = await response.json()
    expect(result.total).toBe(1)
    expect(result.rows.map((row: { match_id: string }) => row.match_id)).toEqual([match.match_id])
  }
  await expect(page.getByText('1 matching match', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect match / })).toHaveCount(1)
}

async function expectPreMatchForm(page: Page, selected: MatchObservation) {
  const expected = preMatchReference(selected)
  const dialog = page.getByRole('dialog', {
    name: `${selected.team_a} vs ${selected.team_b}`,
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(manifest.dataset_version)
  await expect(dialog).toContainText('versioned observation history')
  for (const [side, rows] of [
    ['A', expected.teamA],
    ['B', expected.teamB],
  ] as const) {
    const form = dialog.getByRole('region', { name: `Team ${side} recent form`, exact: true })
    await expect(form).toContainText(`${rows.length} prior matches`)
    for (const match of rows) {
      const teamId = side === 'A' ? selected.team_a_id : selected.team_b_id
      const targetIsA = match.team_a_id === teamId
      const scored = targetIsA ? match.score_a : match.score_b
      const conceded = targetIsA ? match.score_b : match.score_a
      const opponent = targetIsA ? match.team_b : match.team_a
      await expect(form).toContainText(`vs ${opponent}`)
      await expect(form).toContainText(`${displayDate(match.start_time)} UTC`)
      await expect(form).toContainText(`${scored}–${conceded}`)
    }
    // The selected match's result must never appear in its own pre-match form.
    await expect(form).not.toContainText(`${displayDate(selected.start_time)} UTC`)
  }
  const h2h = dialog.getByRole('region', { name: 'Head-to-head evidence', exact: true })
  await expect(h2h).toContainText(`${expected.h2h.length} prior meetings`)
  for (const match of expected.h2h.slice(0, 10)) {
    await expect(h2h).toContainText(`${displayDate(match.start_time)} UTC`)
    await expect(h2h).toContainText(`${match.score_a}–${match.score_b}`)
  }
  return dialog
}

test('match research combines date, competition and team filters with truthful scores and pagination', async ({
  page,
}, testInfo) => {
  await openApplication(page)
  await capture(page, testInfo, `arena-match-center-${testInfo.project.name}.png`)
  const upcoming = allMatches.find((m) => m.match_id === 'synthetic:football:000592')!
  await filterExactMatch(page, upcoming)
  const day = page.getByRole('region', {
    name: `Matches on ${upcoming.start_time.slice(0, 10)}`,
    exact: true,
  })
  const scheduledRow = inspectMatch(day, upcoming)
  await expect(scheduledRow.getByLabel('Score unavailable', { exact: true })).toBeVisible()
  await expect(scheduledRow).toContainText('Scheduled')
  await scheduledRow.click()
  const upcomingDetail = await expectPreMatchForm(page, upcoming)
  await expect(
    upcomingDetail.getByRole('region', { name: 'Match scoreboard', exact: true }),
  ).toContainText('— : —')
  await expect(
    upcomingDetail.getByRole('region', { name: 'Match scoreboard', exact: true }),
  ).toContainText('Scheduled at snapshot cutoff')
  await expect(
    upcomingDetail
      .getByRole('region', { name: 'Stored match forecast', exact: true })
      .getByRole('img'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Close match details', exact: true }).click()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  const completed = allMatches.find((m) => m.match_id === 'synthetic:football:000440')!
  await filterExactMatch(page, completed)
  const completedRow = inspectMatch(page, completed)
  await expect(
    completedRow.getByLabel(`${completed.score_a} to ${completed.score_b} goals`, { exact: true }),
  ).toBeVisible()
  await expect(completedRow).toContainText('Final')
  await completedRow.click()
  const completedDetail = await expectPreMatchForm(page, completed)
  await expect(
    completedDetail.getByRole('region', { name: 'Match scoreboard', exact: true }),
  ).toContainText(`${completed.score_a} : ${completed.score_b}`)
  await expect(
    completedDetail.getByRole('region', { name: 'Match scoreboard', exact: true }),
  ).toContainText('Final · goals')
  await expect(
    completedDetail.getByRole('region', { name: 'Stored match forecast', exact: true }),
  ).toContainText('No stored forecast exists')
  await capture(page, testInfo, `arena-historic-match-${testInfo.project.name}.png`, false)
  await page.keyboard.press('Escape')
  await expect(completedDetail).not.toBeVisible()
  await page
    .getByRole('textbox', { name: 'Search matches', exact: true })
    .fill('unlisted-test-match')
  await expect(page.getByText(/No matches match these filters/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  const total = allMatches.filter((m) => m.sport === 'football' && m.status === 'finished').length
  await expect(page.getByText(`${total} matching matches`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText(`26–50 of ${total}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText(`1–25 of ${total}`, { exact: true })).toBeVisible()
  await noPageOverflow(page)
})

test('competition research connects observed tables, historic matches and team profiles across sports', async ({
  page,
}, testInfo) => {
  await openApplication(page)
  const football = allMatches.find((m) => m.match_id === 'synthetic:football:000440')!
  await navigate(page, 'Competitions')
  await expect(page.getByRole('button', { name: /^Inspect competition / })).toHaveCount(3)
  await page
    .getByRole('textbox', { name: 'Search competitions', exact: true })
    .fill(football.competition)
  await expect(page.getByRole('button', { name: /^Inspect competition / })).toHaveCount(1)
  await page
    .getByRole('button', { name: `Inspect competition ${football.competition}`, exact: true })
    .click()
  await expect(page.getByRole('heading', { name: football.competition, exact: true })).toBeVisible()
  await expect(
    page.getByText(/This is not official standings, a bracket or a complete season record/),
  ).toBeVisible()
  const table = page.getByRole('table', { name: 'Observed results table', exact: true })
  await expect(table.getByRole('columnheader')).toHaveText([
    '#',
    'Team',
    'P',
    'W',
    'D',
    'L',
    'GF',
    'GA',
    'Diff',
    'Pts',
    'Last 5',
  ])
  for (const expected of observedFootballTable(football.competition)) {
    const row = table
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: expected.team_name, exact: true }) })
    const difference = expected.goals_for - expected.goals_against
    const cells = row.getByRole('cell')
    await expect(cells).toHaveCount(10)
    await expect(cells.nth(1)).toHaveText(String(expected.played))
    await expect(cells.nth(2)).toHaveText(String(expected.wins))
    await expect(cells.nth(3)).toHaveText(String(expected.draws))
    await expect(cells.nth(4)).toHaveText(String(expected.losses))
    await expect(cells.nth(5)).toHaveText(String(expected.goals_for))
    await expect(cells.nth(6)).toHaveText(String(expected.goals_against))
    await expect(cells.nth(7)).toHaveText(`${difference > 0 ? '+' : ''}${difference}`)
    await expect(cells.nth(8)).toHaveText(String(expected.points))
  }
  await capture(page, testInfo, `arena-competition-${testInfo.project.name}.png`, false)
  // Event history is intentionally capped at 30 rows, so choose a known match in that visible window.
  const eventMatch = allMatches
    .filter((m) => m.sport === 'football' && m.competition === football.competition)
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))[12]
  await inspectMatch(page, eventMatch).click()
  const detail = await expectPreMatchForm(page, eventMatch)
  await detail.getByRole('button', { name: eventMatch.team_a, exact: true }).first().click()
  await expect(page.getByRole('heading', { name: eventMatch.team_a, exact: true })).toBeVisible()
  await expect(page.getByText('Goal difference', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'VALORANT', exact: true }).click()
  await navigate(page, 'Events')
  await expect(page.getByRole('button', { name: /^Inspect event / })).toHaveCount(3)
  await capture(page, testInfo, `arena-valorant-events-${testInfo.project.name}.png`, false)
  const valorant = allMatches.find((m) => m.match_id === 'synthetic:valorant:000595')!
  await page
    .getByRole('button', { name: `Inspect event ${valorant.competition}`, exact: true })
    .click()
  const seriesTable = page.getByRole('table', { name: 'Observed results table', exact: true })
  await expect(seriesTable.getByRole('columnheader')).toHaveText([
    '#',
    'Team',
    'P',
    'W',
    'L',
    'MF',
    'MA',
    'Diff',
    'Win %',
    'Last 5',
  ])
  await expect(page.getByText('Series wins · maps won', { exact: true })).toBeVisible()
  await capture(page, testInfo, `arena-valorant-event-${testInfo.project.name}.png`, false)
  await inspectMatch(page, valorant).click()
  const series = await expectPreMatchForm(page, valorant)
  await expect(series).toContainText('VALORANT · best of 3')
  await expect(
    series
      .getByRole('region', { name: 'Stored match forecast', exact: true })
      .getByText('Draw', { exact: true }),
  ).toHaveCount(0)
  await expect(
    series
      .getByRole('region', { name: 'Head-to-head evidence', exact: true })
      .getByText('Draws', { exact: true }),
  ).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('match')).toBe(valorant.match_id)
  expect(new URL(page.url()).searchParams.get('sport')).toBe('valorant')
  await page.goBack()
  await expect(series).not.toBeVisible()
  await page.goForward()
  await expectPreMatchForm(page, valorant)
  await page.reload()
  await expectPreMatchForm(page, valorant)
  await page.keyboard.press('Escape')
  await noPageOverflow(page)
})
