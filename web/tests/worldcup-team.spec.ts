import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { capture, noPageOverflow } from './journeys'

type Match = {
  match_id: string
  edition_id: string
  team_a_id: string
  team_a: string
  team_b_id: string
  team_b: string
  source_date: string
  source_match_number: number | null
}
const directory = new URL('../../src/arena_copilot/research_fixture/', import.meta.url)
const matches: Match[] = JSON.parse(readFileSync(new URL('matches.json', directory), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const world = matches.filter((row) => row.edition_id === 'worldcup-2026')
const rollover = world.find((row) => row.team_a === 'South Korea')!
const final = world.find((row) => row.source_match_number === 104)!
const penalties = world.find((row) => row.source_match_number === 74)!
const mexicoRows = world
  .filter((row) => row.team_a === 'Mexico' || row.team_b === 'Mexico')
  .sort((a, b) => b.source_date.localeCompare(a.source_date))
const mexicoId = () => {
  const row = mexicoRows[0]
  return row.team_a === 'Mexico' ? row.team_a_id : row.team_b_id
}
const label = (row: Match) =>
  `Inspect open match ${row.team_a} vs ${row.team_b}, ${row.source_date}`
const title = (row: Match) => `${row.team_a} vs ${row.team_b}`
const linkId = (field: string, id: string) => new RegExp(`${field}=${encodeURIComponent(id)}`)
const sourceRef = '516d3825c3bd23fdc298c4014e84bde78f2d4965'
const sourceHash = '0ae2c18109b5aa86bc11928b43586ca430c234804d5bbf808d2c3bf2051ecfca'

async function start(page: Page, live: boolean, requests: string[], query = '') {
  page.on('request', (request) => requests.push(request.url()))
  const transport = page.waitForResponse((response) =>
    live
      ? response.url().endsWith('/api/open-football/snapshot') && response.status() === 200
      : response.url().endsWith('/lakehouse-copilot/open-football.json') &&
        response.status() === 200,
  )
  await page.goto(`./?view=open-football${query}`)
  const payload = await (await transport).json()
  expect(payload.manifest.research_version).toBe('openfootball-research-2.0')
  expect(payload.manifest.dataset_version).toBe(manifest.dataset_version)
  expect(payload.matches).toHaveLength(2831)
  expect(payload.teams).toHaveLength(261)
  expect(
    payload.teams.filter((team: { team_type: string }) => team.team_type === 'national'),
  ).toHaveLength(48)
  expect(world).toHaveLength(104)
  await expect(
    page.getByRole('navigation', { name: 'Open football research', includeHidden: true }),
  ).toBeVisible()
  return payload
}

function staticIsolation(requests: string[], live: boolean) {
  if (!live) expect(requests.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([])
}

async function expandFilters(page: Page) {
  const toggle = page.getByRole('button', { name: 'Filter source records', exact: true })
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click()
  await expect(page.getByRole('combobox', { name: 'Filter edition', exact: true })).toBeVisible()
}

async function showMatch(page: Page, row: Match) {
  await page.getByRole('button', { name: label(row), exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title(row), exact: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(linkId('research_match', row.match_id))
  return dialog
}

async function askEvidence(
  page: Page,
  scope: Locator,
  live: boolean,
  question: string,
  fingerprint: string,
) {
  await scope.getByRole('textbox', { name: 'Research question', exact: true }).fill(question)
  const response = live
    ? page.waitForResponse(
        (result) =>
          result.url().endsWith('/api/open-football/chat') && result.request().method() === 'POST',
      )
    : undefined
  await scope.getByRole('button', { name: 'Ask research', exact: true }).click()
  let raw: any
  if (response) {
    const result = await response
    expect(result.status()).toBe(200)
    raw = await result.json()
    expect(raw.provider).toBe('openfootball')
    expect(raw.data_kind).toBe('open_data')
    expect(raw.dataset_version).toBe(manifest.dataset_version)
    expect(raw.snapshot_fingerprint).toBe(fingerprint)
    expect(raw.mode).toBe('evidence')
  }
  await expect(scope.getByRole('button', { name: 'Ask research', exact: true })).toBeEnabled()
  const answer = scope.getByRole('region', { name: 'Research answer', exact: true })
  await expect(answer).toBeVisible()
  await expect(answer.getByText(manifest.dataset_version, { exact: true })).toBeVisible()
  await expect(answer.getByText(fingerprint, { exact: true })).toBeVisible()
  await expect(answer).toContainText('No model called')
  const toolEvidence = answer.getByRole('region', { name: /^Research evidence / }).first()
  if (!(await toolEvidence.isVisible()))
    await answer.getByText('Inspect research tool evidence', { exact: true }).click()
  return { answer, raw }
}

test('World Cup source dates, UTC rollover and knockout phases remain distinct in match research', async ({
  page,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  await start(page, live, requests)
  await expandFilters(page)
  await page
    .getByRole('combobox', { name: 'Filter region', exact: true })
    .selectOption('International')
  const edition = page.getByRole('combobox', { name: 'Filter edition', exact: true })
  await expect(edition.getByRole('option')).toHaveCount(2)
  await edition.selectOption('worldcup-2026')
  await expect(page).toHaveURL(/research_edition=worldcup-2026/)
  await expect(
    page.getByRole('status').filter({ hasText: /^104 matching source records$/ }),
  ).toBeVisible()
  await page.getByLabel('Source calendar date', { exact: true }).fill('2026-06-11')
  await expect(page.getByRole('button', { name: /^Inspect open match / })).toHaveCount(2)
  const rolloverTrigger = page.getByRole('button', { name: label(rollover), exact: true })
  await expect(rolloverTrigger).toContainText('UTC−06:00')
  let dialog = await showMatch(page, rollover)
  const precision = dialog.getByRole('region', { name: 'Source kickoff precision' })
  await expect(precision).toContainText('11 Jun 2026')
  await expect(precision).toContainText('20:00')
  await expect(precision).toContainText('Offset-derived UTC')
  await expect(precision).toContainText('12 Jun 2026, 02:00 UTC')
  await expect(precision).toContainText('no IANA timezone assumed')
  const provenance = dialog.getByRole('region', { name: 'Source provenance' })
  await expect(provenance).toContainText('Group A')
  await expect(provenance).toContainText('Guadalajara (Zapopan)')
  await expect(provenance.getByText(sourceHash, { exact: true })).toBeVisible()
  await expect(provenance.getByRole('link', { name: /2026\/worldcup\.json/ })).toHaveAttribute(
    'href',
    `https://raw.githubusercontent.com/openfootball/worldcup.json/${sourceRef}/2026/worldcup.json`,
  )
  await capture(page, testInfo, `worldcup-offset-${testInfo.project.name}.png`, false)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(rolloverTrigger).toBeFocused()
  await page.getByLabel('Source calendar date', { exact: true }).fill('2026-06-12')
  await expect(page.getByRole('button', { name: label(rollover), exact: true })).toHaveCount(0)
  await page.getByLabel('Source calendar date', { exact: true }).fill('')
  const search = page.getByRole('searchbox', { name: 'Search open football', exact: true })
  await search.fill(final.match_id)
  dialog = await showMatch(page, final)
  await expect(dialog.getByRole('region', { name: 'Open match scoreboard' })).toContainText(
    'Observed result',
  )
  const stages = dialog.getByRole('region', { name: 'Score detail' })
  await expect(stages).toContainText('Full-time (source)')
  await expect(stages).toContainText('0 – 0')
  await expect(stages).toContainText('Extra-time (source)')
  await expect(stages).toContainText('1 – 0')
  await expect(dialog).toContainText('no forecast attached')
  await expect(dialog.getByRole('region', { name: 'Source provenance' })).toContainText('104')
  await expect(dialog.getByRole('region', { name: 'Source kickoff precision' })).toContainText(
    '19 Jul 2026, 19:00 UTC',
  )
  await capture(page, testInfo, `worldcup-final-${testInfo.project.name}.png`, false)
  await dialog.getByRole('button', { name: 'Close open match details', exact: true }).click()
  await search.fill(penalties.match_id)
  dialog = await showMatch(page, penalties)
  const penaltyStages = dialog.getByRole('region', { name: 'Score detail' })
  await expect(penaltyStages).toContainText('1 – 1')
  await expect(penaltyStages).toContainText('Extra-time (source)')
  await expect(penaltyStages).toContainText('Penalties (source)')
  await expect(penaltyStages).toContainText('3 – 4')
  await dialog.getByRole('button', { name: 'Inspect source team Germany', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Source team profile' })
      .getByRole('heading', { name: 'Germany.', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await noPageOverflow(page)
  staticIsolation(requests, live)
})

test('national source teams navigate by stable IDs through profiles, records, opponents and browser history', async ({
  page,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  await start(page, live, requests)
  await page
    .getByRole('navigation', { name: 'Open football research' })
    .getByRole('button', { name: 'Source teams', exact: true })
    .click()
  const directory = page.getByRole('region', { name: 'Source team directory', exact: true })
  await directory
    .getByRole('combobox', { name: 'Filter source teams by region' })
    .selectOption('International')
  await directory
    .getByRole('combobox', { name: 'Filter source teams by type' })
    .selectOption('national')
  await expect(directory.getByRole('status')).toHaveText('48 matching source teams')
  await expect(directory.getByRole('button', { name: /^Inspect source team / })).toHaveCount(30)
  await directory.getByRole('button', { name: 'Show more source teams' }).click()
  await expect(directory.getByRole('button', { name: /^Inspect source team / })).toHaveCount(48)
  await expect(directory.getByRole('button', { name: 'Show more source teams' })).toHaveCount(0)
  await directory
    .getByRole('combobox', { name: 'Filter source teams by type' })
    .selectOption('club')
  await expect(directory.getByRole('status')).toHaveText('0 matching source teams')
  await expect(
    directory.getByRole('heading', { name: 'No imported teams for this filter.' }),
  ).toBeVisible()
  await directory
    .getByRole('combobox', { name: 'Filter source teams by type' })
    .selectOption('national')
  await directory.getByRole('searchbox', { name: 'Search source teams' }).fill('mExIcO')
  await expect(directory.getByRole('status')).toHaveText('1 matching source team')
  await directory.getByRole('button', { name: 'Inspect source team Mexico', exact: true }).click()
  await expect(page).toHaveURL(linkId('research_team', mexicoId()))
  let profile = page.getByRole('region', { name: 'Source team profile', exact: true })
  await expect(profile.getByRole('heading', { name: 'Mexico.', exact: true })).toBeVisible()
  await expect(profile).toContainText('Latest 5 of 5 records')
  await expect(profile).toContainText('no global wins, draws or losses are inferred')
  await expect(profile.getByRole('button', { name: /^Inspect open match / })).toHaveCount(5)
  expect(
    await profile
      .getByRole('button', { name: /^Inspect open match / })
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
  ).toEqual(mexicoRows.map(label))
  await capture(page, testInfo, `worldcup-mexico-${testInfo.project.name}.png`, false)
  await page.reload()
  await expect(profile.getByRole('heading', { name: 'Mexico.', exact: true })).toBeVisible()
  await profile.getByRole('button', { name: 'Inspect source team England', exact: true }).click()
  await expect(profile.getByRole('heading', { name: 'England.', exact: true })).toBeVisible()
  await page.goBack()
  await expect(profile.getByRole('heading', { name: 'Mexico.', exact: true })).toBeVisible()
  await expect(page).toHaveURL(linkId('research_team', mexicoId()))
  await profile.getByRole('button', { name: 'View all team records', exact: true }).click()
  await expect(page).toHaveURL(linkId('research_team_filter', mexicoId()))
  await expect(page.getByRole('button', { name: /^Inspect open match / })).toHaveCount(5)
  await expect(
    page.getByRole('status').filter({ hasText: /^5 matching source records$/ }),
  ).toBeVisible()
  await showMatch(page, mexicoRows[0])
  await page.keyboard.press('Escape')
  await noPageOverflow(page)
  await page.goto(
    './?view=open-football&research_team=openfootball%3Ateam%3A000000000000000000000000',
  )
  profile = page.getByRole('region', { name: 'Source team profile', exact: true })
  await expect(
    profile.getByRole('heading', { name: 'Source team unavailable.', exact: true }),
  ).toBeVisible()
  await expect(profile).toContainText('No other team was selected as a substitute')
  await profile.getByRole('button', { name: 'Back to source teams', exact: true }).click()
  await expect(directory).toBeVisible()
  staticIsolation(requests, live)
})

test('research evidence uses the selected real source context with explicit static limits and separate local feedback', async ({
  page,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  const snapshot = await start(
    page,
    live,
    requests,
    `&research_match=${encodeURIComponent(final.match_id)}`,
  )
  const dialog = page.getByRole('dialog', { name: title(final), exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByText('Ask about this match', { exact: true }).click()
  if (!live) {
    await expect(dialog.getByText('Deterministic source summary', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Local research AI' })).toHaveCount(0)
  }
  const first = await askEvidence(
    page,
    dialog,
    live,
    'Summarize this match source scores and clock.',
    snapshot.snapshot_fingerprint,
  )
  const matchEvidence = first.answer.getByRole('region', {
    name: 'Research evidence research_match',
    exact: true,
  })
  await expect(matchEvidence).toContainText(final.match_id)
  await expect(matchEvidence).toContainText('"source_match_number": 104')
  await expect(matchEvidence).toContainText('"start_time": "2026-07-19T19:00:00.000000Z"')
  await expect(matchEvidence).toContainText(sourceHash)
  await expect(matchEvidence).toContainText('"et"')
  if (live) {
    const feedback = page.waitForResponse((response) =>
      response.url().endsWith('/api/open-football/feedback'),
    )
    await first.answer.getByRole('button', { name: 'Helpful research answer', exact: true }).click()
    const saved = await feedback
    expect(saved.status()).toBe(200)
    expect((await saved.json()).trace_id).toBe(first.raw.trace_id)
    await expect(first.answer.getByRole('status')).toHaveText('Research feedback saved.')
    await expect(
      first.answer.getByRole('button', { name: 'Helpful research answer', exact: true }),
    ).toBeDisabled()
    const ai = dialog.getByRole('checkbox', { name: 'Local research AI', exact: true })
    await ai.check()
    const unavailable = page.waitForResponse((response) =>
      response.url().endsWith('/api/open-football/chat'),
    )
    await dialog.getByRole('button', { name: 'Ask research', exact: true }).click()
    expect((await unavailable).status()).toBe(503)
    await expect(dialog.getByRole('alert')).toContainText('not replaced with a public answer')
    await expect(dialog.getByRole('region', { name: 'Research answer' })).toHaveCount(0)
    await ai.uncheck()
  } else {
    await expect(first.answer).toContainText('Browser evidence ID')
    await expect(
      first.answer.getByRole('button', { name: 'Helpful research answer', exact: true }),
    ).toHaveCount(0)
  }
  const forecast = await askEvidence(
    page,
    dialog,
    live,
    'Predict the winning team and its probability.',
    snapshot.snapshot_fingerprint,
  )
  await expect(forecast.answer).toContainText('Evidence limit')
  await expect(forecast.answer).toContainText(/prediction.ineligible|forecast/i)
  await expect(
    forecast.answer.getByRole('region', { name: 'Research evidence research_quality' }),
  ).toBeVisible()
  await capture(page, testInfo, `worldcup-research-${testInfo.project.name}.png`, false)
  await dialog.getByRole('button', { name: 'Close open match details', exact: true }).click()
  await page.goto(`./?view=open-football&research_team=${encodeURIComponent(mexicoId())}`)
  const profile = page.getByRole('region', { name: 'Source team profile', exact: true })
  await profile.getByText('Ask about this team', { exact: true }).click()
  const team = await askEvidence(
    page,
    profile,
    live,
    'Show the imported team coverage.',
    snapshot.snapshot_fingerprint,
  )
  await expect(
    team.answer.getByRole('region', { name: 'Research evidence research_team', exact: true }),
  ).toContainText(mexicoId())
  await expect(team.answer).toContainText('"record_count": 5')
  await expect(team.answer).toContainText('"unknown_results": 0')
  await noPageOverflow(page)
  staticIsolation(requests, live)
})
