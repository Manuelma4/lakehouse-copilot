import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { capture, noPageOverflow } from './journeys'

type RecordRow = {
  match_id: string
  edition_id: string
  team_a: string
  team_b: string
  team_a_id: string
  team_b_id: string
  source_group: string | null
  round: string | null
  source_date: string
  local_time: string | null
  result_status: string
  observed_at: string
}
const directory = new URL('../../src/arena_copilot/research_fixture/', import.meta.url)
const matches: RecordRow[] = JSON.parse(readFileSync(new URL('matches.json', directory), 'utf8'))
const polls = JSON.parse(readFileSync(new URL('polls.json', directory), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const world = matches.filter((row) => row.edition_id === 'worldcup-2026')
const label = (row: RecordRow) =>
  `Inspect open match ${row.team_a} vs ${row.team_b}, ${row.source_date}`
function ordered(rows: RecordRow[]) {
  return [...rows].sort(
    (a, b) =>
      b.source_date.localeCompare(a.source_date) ||
      (a.local_time || '').localeCompare(b.local_time || '') ||
      a.match_id.localeCompare(b.match_id),
  )
}
async function start(page: Page, live: boolean, requests: string[], query: string) {
  page.on('request', (request) => requests.push(request.url()))
  const loaded = page.waitForResponse((response) =>
    live
      ? response.url().endsWith('/api/open-football/snapshot') && response.status() === 200
      : response.url().endsWith('/lakehouse-copilot/open-football.json') &&
        response.status() === 200,
  )
  await page.goto(`./?view=open-football${query}`)
  const payload = await (await loaded).json()
  expect(payload.manifest.dataset_version).toBe(manifest.dataset_version)
  await expect(page.getByRole('navigation', { name: 'Open football research' })).toBeVisible()
}
async function expandFilters(page: Page) {
  const toggle = page.getByRole('button', { name: 'Filter source records', exact: true })
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click()
  await expect(
    page.getByRole('combobox', { name: 'Filter source group', exact: true }),
  ).toBeVisible()
}
async function rows(page: Page, expected: RecordRow[], offset = 0) {
  const records = page.getByRole('button', { name: /^Inspect open match / })
  await expect(records).toHaveCount(Math.min(25, Math.max(0, expected.length - offset)))
  await expect
    .poll(() =>
      records.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
    )
    .toEqual(
      ordered(expected)
        .slice(offset, offset + 25)
        .map(label),
    )
  await expect(
    page.getByRole('status').filter({ hasText: /^\d[\d,]* matching source records?$/ }),
  ).toHaveText(
    `${expected.length.toLocaleString('en-GB')} matching source ${expected.length === 1 ? 'record' : 'records'}`,
  )
}
function isolate(requests: string[], live: boolean) {
  if (!live) expect(requests.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([])
}

test('exact source groups and rounds combine with date and search through reload and stable team navigation', async ({
  page,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  await start(page, live, requests, '&research_edition=worldcup-2026&research_group=Group+A')
  await expandFilters(page)
  const group = page.getByRole('combobox', { name: 'Filter source group', exact: true })
  const round = page.getByRole('combobox', { name: 'Filter source round', exact: true })
  const day = page.getByLabel('Source calendar date', { exact: true })
  const search = page.getByRole('searchbox', { name: 'Search open football', exact: true })
  const groupA = world.filter((row) => row.source_group === 'Group A')
  expect(groupA).toHaveLength(6)
  await rows(page, groupA)
  const suppliedGroups = [...new Set(world.map((row) => row.source_group).filter(Boolean))].sort()
  expect(
    await group
      .locator('option')
      .evaluateAll((nodes) => nodes.slice(1).map((node) => (node as HTMLOptionElement).value)),
  ).toEqual(suppliedGroups)
  await round.selectOption('Matchday 1')
  await day.fill('2026-06-11')
  await search.fill('Mexico')
  const selected = groupA.filter(
    (row) =>
      row.round === 'Matchday 1' &&
      row.source_date === '2026-06-11' &&
      [row.team_a, row.team_b].includes('Mexico'),
  )
  expect(selected).toHaveLength(1)
  await rows(page, selected)
  await expect(page).toHaveURL(/research_round=Matchday\+1/)
  await expect(page).toHaveURL(/research_date=2026-06-11/)
  await expect(page).toHaveURL(/research_search=Mexico/)
  if (live) {
    const response = await page.request.get('/api/open-football/matches', {
      params: {
        edition_id: 'worldcup-2026',
        source_group: 'Group A',
        round: 'Matchday 1',
        date_from: '2026-06-11',
        date_to: '2026-06-11',
        search: 'Mexico',
        result_status: 'observed_result',
      },
    })
    expect(response.status()).toBe(200)
    expect((await response.json()).rows.map((row: RecordRow) => row.match_id)).toEqual(
      selected.map((row) => row.match_id),
    )
  }
  await page.reload()
  await rows(page, selected)
  await expandFilters(page)
  await expect(group).toHaveValue('Group A')
  await expect(round).toHaveValue('Matchday 1')
  await expect(day).toHaveValue('2026-06-11')
  await expect(search).toHaveValue('Mexico')
  await page.getByRole('button', { name: label(selected[0]), exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: `${selected[0].team_a} vs ${selected[0].team_b}`,
    exact: true,
  })
  await dialog.getByRole('button', { name: 'Inspect source team Mexico', exact: true }).click()
  const mexicoId = selected[0].team_a === 'Mexico' ? selected[0].team_a_id : selected[0].team_b_id
  await expect(page).toHaveURL(new RegExp(`research_team=${encodeURIComponent(mexicoId)}`))
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Source team profile' })
      .getByRole('heading', { name: 'Mexico.', exact: true }),
  ).toBeVisible()
  await page.goBack()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await rows(page, selected)
  await page.goBack()
  await rows(
    page,
    groupA.filter((row) => row.round === 'Matchday 1'),
  )
  await page.goForward()
  await rows(page, selected)
  await expandFilters(page)
  await group.selectOption('')
  await day.fill('')
  await search.fill('')
  await round.selectOption('Round of 32')
  const knockout = world.filter((row) => row.round === 'Round of 32')
  expect(knockout).toHaveLength(16)
  await rows(page, knockout)
  await capture(page, testInfo, `source-round-${testInfo.project.name}.png`, false)
  await round.selectOption('')
  await rows(page, world)
  await page.getByRole('button', { name: 'Next source records page', exact: true }).click()
  await rows(page, world, 25)
  await group.selectOption('Group A')
  await rows(page, groupA)
  await page.getByRole('button', { name: 'Result unknown', exact: true }).click()
  await rows(page, [])
  await expect(page.getByRole('table')).toHaveCount(0)
  await noPageOverflow(page)
  isolate(requests, live)
})

test('edition collection checks remain separate from stale source results and unknown score coverage', async ({
  page,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  await start(page, live, requests, '&research_edition=colombia-primera-a-2025')
  const coverage = page.getByRole('region', { name: 'Source collection and coverage', exact: true })
  const colombia = matches.filter((row) => row.edition_id === 'colombia-primera-a-2025')
  const latestPoll = polls.filter((row: any) => row.source_id === 'colombia-primera-a-2025').at(-1)
  const field = (name: string) =>
    coverage.locator('dl > div').filter({ has: page.getByText(name, { exact: true }) })
  await expect(field('Last successful source check').locator('time')).toHaveAttribute(
    'datetime',
    latestPoll.observed_at,
  )
  await expect(field('Latest included result date')).toContainText('4 May 2025')
  await expect(field('Observed results')).toContainText('167')
  await expect(field('Results unknown')).toContainText('33')
  await expect(field('Observed results')).toContainText('200 imported records')
  await expect(coverage).toContainText('does not establish complete results or a live feed')
  await coverage.getByText('Inspect collection evidence', { exact: true }).click()
  const lastMatchObservedAt = [...colombia].sort((a, b) =>
    b.observed_at.localeCompare(a.observed_at),
  )[0].observed_at
  await expect(field('Latest included match observation').locator('time')).toHaveAttribute(
    'datetime',
    lastMatchObservedAt,
  )
  await expect(field('Package cutoff').locator('time')).toHaveAttribute('datetime', manifest.as_of)
  expect(Date.parse(latestPoll.observed_at)).toBeGreaterThan(Date.parse(lastMatchObservedAt))
  await expect(field('Current source reference')).toContainText('master')
  await expect(field('Current source reference')).toContainText(
    'Moving upstream reference; not a pinned commit',
  )
  await expect(field('Last checked content SHA256')).toContainText(latestPoll.sha256)
  await expect(field('Successful checks included')).toContainText('2')
  await capture(page, testInfo, `source-coverage-${testInfo.project.name}.png`, false)
  await page.getByRole('button', { name: 'Result unknown', exact: true }).click()
  await rows(
    page,
    colombia.filter((row) => row.result_status === 'unknown_result'),
  )
  // Changing visible result filters must not reinterpret full-edition coverage.
  await expect(field('Results unknown')).toContainText('33')
  await expect(field('Observed results')).toContainText('167')
  await expect(page.getByRole('button', { name: /Upcoming|Live now/, exact: true })).toHaveCount(0)
  await expandFilters(page)
  await expect(
    page.getByRole('combobox', { name: 'Filter source group', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('combobox', { name: 'Filter edition', exact: true })
    .selectOption('worldcup-2026')
  await expect(field('Current source reference')).toContainText(
    '516d3825c3bd23fdc298c4014e84bde78f2d4965',
  )
  await expect(field('Source clock precision')).toContainText('104 explicit offset')
  await noPageOverflow(page)
  isolate(requests, live)
})

test('a public package with invalid collection evidence fails closed', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'live-desktop',
    'The local service validates sealed packages independently.',
  )
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  // Corrupt an isolated response in memory; never change the packaged fixture.
  await page.route('**/open-football.json', async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    payload.polls[0].status = 'failed'
    await route.fulfill({ response, json: payload })
  })
  await page.goto('./?view=open-football&research_edition=worldcup-2026')
  await expect(
    page.getByRole('heading', { name: 'OpenFootball sources are unavailable.' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Source collection evidence is invalid')
  await expect(page.getByRole('button', { name: /^Inspect open match / })).toHaveCount(0)
  await noPageOverflow(page)
  isolate(requests, false)
})
