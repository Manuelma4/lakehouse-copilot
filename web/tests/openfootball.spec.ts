import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { capture, navigate, noPageOverflow } from './journeys'

type SourceMatch = {
  match_id: string
  edition_id: string
  team_a: string
  team_b: string
  source_date: string
  local_time: string | null
  kickoff_precision: string
  result_status: 'observed_result' | 'unknown_result'
  score_a: number | null
  score_b: number | null
  observed_at: string
  source_url: string
  license_url: string
  source_sha256: string
  score_details_json: string
}
type Edition = {
  edition_id: string
  name: string
  season: string
  region: string
  match_count: number
}

const directory = new URL('../../src/arena_copilot/research_fixture/', import.meta.url)
const matches: SourceMatch[] = JSON.parse(readFileSync(new URL('matches.json', directory), 'utf8'))
const editions: Edition[] = JSON.parse(
  readFileSync(new URL('competitions.json', directory), 'utf8'),
)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
// Hand-reviewed source records from the frozen CC0 package, not generated test predictions.
const unknown = matches.find(
  (row) => row.match_id === 'openfootball:match:03392e67e692177a012d3a9d',
)!
const drawn = matches.find((row) => row.match_id === 'openfootball:match:02136998d370fa2164b39abf')!
const knockout = matches.find(
  (row) => row.match_id === 'openfootball:match:0ecadd76a44de72a26727327',
)!
const label = (row: SourceMatch) =>
  `Inspect open match ${row.team_a} vs ${row.team_b}, ${row.source_date}`

function sorted(rows: SourceMatch[]) {
  return [...rows].sort(
    (a, b) =>
      b.source_date.localeCompare(a.source_date) ||
      (a.local_time || '').localeCompare(b.local_time || '') ||
      a.match_id.localeCompare(b.match_id),
  )
}
async function expectRows(page: Page, rows: SourceMatch[], offset = 0) {
  const visible = sorted(rows).slice(offset, offset + 25)
  const records = page.getByRole('button', { name: /^Inspect open match / })
  await expect(records).toHaveCount(visible.length)
  await expect
    .poll(() =>
      records.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
    )
    .toEqual(visible.map(label))
  await expect(
    page.getByRole('status').filter({ hasText: /^\d[\d,]* matching source records?$/ }),
  ).toHaveText(
    `${rows.length.toLocaleString('en-GB')} matching source ${rows.length === 1 ? 'record' : 'records'}`,
  )
}
async function expandFilters(page: Page) {
  const toggle = page.getByRole('button', { name: 'Filter source records', exact: true })
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click()
  await expect(page.getByRole('combobox', { name: 'Filter region', exact: true })).toBeVisible()
}
async function start(page: Page, live: boolean, requests: string[]) {
  page.on('request', (request) => requests.push(request.url()))
  const transport = page.waitForResponse((response) =>
    live
      ? response.url().endsWith('/api/open-football/snapshot') && response.status() === 200
      : response.url().endsWith('/lakehouse-copilot/open-football.json') &&
        response.status() === 200,
  )
  await page.goto('./?view=open-football')
  const payload = await (await transport).json()
  expect(payload.manifest.dataset_version).toBe(manifest.dataset_version)
  expect(payload.matches).toHaveLength(2831)
  expect(payload.competitions).toHaveLength(10)
  await expect(page.getByRole('heading', { name: 'Open football.', exact: true })).toBeVisible()
}
function assertStaticIsolation(requests: string[], live: boolean) {
  if (!live) expect(requests.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([])
}

test('open football filters the ten reviewed editions before pagination and preserves unknown results', async ({
  page,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  await start(page, live, requests)
  expect(matches).toHaveLength(2831)
  expect(matches.filter((row) => row.result_status === 'observed_result')).toHaveLength(1192)
  expect(matches.filter((row) => row.result_status === 'unknown_result')).toHaveLength(1639)
  const observed = matches.filter((row) => row.result_status === 'observed_result')
  await expect(page.getByRole('button', { name: 'Observed result', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expectRows(page, observed)
  await capture(page, testInfo, `open-football-results-${testInfo.project.name}.png`, false)
  await page.getByRole('button', { name: 'Next source records page' }).click()
  await expectRows(page, observed, 25)
  await page.getByRole('button', { name: 'Previous source records page' }).click()
  await expectRows(page, observed)

  await page.getByRole('button', { name: 'All records', exact: true }).click()
  await expectRows(page, matches)
  await expandFilters(page)
  const editionFilter = page.getByRole('combobox', { name: 'Filter edition', exact: true })
  await expect(editionFilter.getByRole('option')).toHaveCount(11)
  for (const edition of editions) {
    await expect(
      editionFilter.getByRole('option', {
        name: `${edition.name} · ${edition.season}`,
        exact: true,
      }),
    ).toHaveCount(1)
  }
  await page
    .getByRole('combobox', { name: 'Filter region', exact: true })
    .selectOption('South America')
  await expect(editionFilter.getByRole('option')).toHaveCount(5)
  await expectRows(
    page,
    matches.filter(
      (row) =>
        editions.find((edition) => edition.edition_id === row.edition_id)?.region ===
        'South America',
    ),
  )
  await editionFilter.selectOption('colombia-primera-a-2025')
  const colombia = matches.filter((row) => row.edition_id === 'colombia-primera-a-2025')
  await expect(page).toHaveURL(/research_edition=colombia-primera-a-2025/)
  await expectRows(
    page,
    colombia.filter((row) => row.result_status === 'observed_result'),
  )
  await page.getByRole('button', { name: 'Result unknown', exact: true }).click()
  await expectRows(
    page,
    colombia.filter((row) => row.result_status === 'unknown_result'),
  )
  await page.getByLabel('Source calendar date', { exact: true }).fill('2025-05-25')
  const onDay = colombia.filter(
    (row) => row.result_status === 'unknown_result' && row.source_date === '2025-05-25',
  )
  await expectRows(page, onDay)
  await page
    .getByRole('searchbox', { name: 'Search open football', exact: true })
    .fill('Alianza FC')
  await expectRows(page, [unknown])
  const unknownRow = page.getByRole('button', { name: label(unknown), exact: true })
  await expect(unknownRow.getByLabel('Score unavailable', { exact: true })).toBeVisible()
  await expect(unknownRow).toContainText('Result unknown')
  await expect(unknownRow).toContainText('Time unavailable')
  await page
    .getByRole('searchbox', { name: 'Search open football', exact: true })
    .fill('No imported team by this name')
  await expectRows(page, [])
  await expect(
    page.getByRole('heading', { name: 'No imported matches for this filter.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Clear source filters', exact: true }).first().click()
  await expectRows(page, observed)
  await expect(editionFilter).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Filter region', exact: true })).toHaveValue('')
  await expect(page.getByLabel('Source calendar date', { exact: true })).toHaveValue('')
  await expect(
    page.getByRole('searchbox', { name: 'Search open football', exact: true }),
  ).toHaveValue('')
  await expect(page.getByRole('table')).toHaveCount(0)
  await noPageOverflow(page)
  assertStaticIsolation(requests, live)
})

test('open match research exposes precise source evidence, truthful score variants and navigable match links', async ({
  page,
  context,
}, testInfo) => {
  const live = testInfo.project.name === 'live-desktop',
    requests: string[] = []
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await start(page, live, requests)
  await page.getByRole('button', { name: 'All records', exact: true }).click()
  await page
    .getByRole('searchbox', { name: 'Search open football', exact: true })
    .fill(unknown.match_id)
  await expectRows(page, [unknown])
  const trigger = page.getByRole('button', { name: label(unknown), exact: true })
  await trigger.click()
  let dialog = page.getByRole('dialog', {
    name: `${unknown.team_a} vs ${unknown.team_b}`,
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`research_match=${encodeURIComponent(unknown.match_id)}`))
  await expect(dialog.getByRole('region', { name: 'Open match scoreboard' })).toContainText(
    'Result unknown',
  )
  const precision = dialog.getByRole('region', { name: 'Source kickoff precision' })
  await expect(precision).toContainText('25 May 2025')
  await expect(precision).toContainText('Time unavailable')
  await expect(precision).toContainText('Date-only record')
  await expect(precision).toContainText('no UTC kickoff instant')
  await expect(dialog.getByRole('region', { name: 'Score detail' })).toContainText(
    'neither a 0–0 result',
  )
  await expect(dialog).toContainText('no forecast attached')
  const provenance = dialog.getByRole('region', { name: 'Source provenance' })
  await expect(provenance.getByText(manifest.dataset_version, { exact: true })).toBeVisible()
  await expect(provenance.getByText(unknown.source_sha256, { exact: true })).toBeVisible()
  await expect(provenance.getByRole('link', { name: /2025\/co\.1\.json/ })).toHaveAttribute(
    'href',
    unknown.source_url,
  )
  await expect(provenance.getByRole('link', { name: /CC0-1\.0/ })).toHaveAttribute(
    'href',
    unknown.license_url,
  )
  await expect(provenance).toContainText('unresolved name derived not official')
  await expect(provenance).toContainText('first_collected_revision')
  const revisions = dialog.getByRole('region', { name: 'Match revisions' })
  await expect(revisions).toContainText('1 stored revision')
  await expect(revisions).toContainText('2026')
  await expect(revisions).toContainText(unknown.source_sha256.slice(0, 16))
  await dialog.getByRole('button', { name: 'Copy open match link', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Open match link copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url())
  await capture(page, testInfo, `open-football-unknown-${testInfo.project.name}.png`, false)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.reload()
  dialog = page.getByRole('dialog', { name: `${unknown.team_a} vs ${unknown.team_b}`, exact: true })
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.goForward()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close open match details' }).click()

  await page
    .getByRole('searchbox', { name: 'Search open football', exact: true })
    .fill(drawn.match_id)
  await expectRows(page, [drawn])
  await page.getByRole('button', { name: label(drawn), exact: true }).click()
  dialog = page.getByRole('dialog', { name: `${drawn.team_a} vs ${drawn.team_b}`, exact: true })
  await expect(dialog.getByRole('region', { name: 'Open match scoreboard' })).toContainText('0 : 0')
  await expect(dialog.getByRole('region', { name: 'Open match scoreboard' })).toContainText(
    'Observed result',
  )
  await expect(dialog.getByRole('region', { name: 'Source kickoff precision' })).toContainText(
    '18:30',
  )
  await expect(dialog.getByRole('region', { name: 'Source kickoff precision' })).toContainText(
    'timezone unresolved',
  )
  await expect(dialog.getByRole('region', { name: 'Source kickoff precision' })).toContainText(
    'no resolved timezone or UTC kickoff instant',
  )
  await dialog.getByRole('button', { name: 'Close open match details' }).click()
  await page
    .getByRole('searchbox', { name: 'Search open football', exact: true })
    .fill(knockout.match_id)
  await expectRows(page, [knockout])
  await page.getByRole('button', { name: label(knockout), exact: true }).click()
  dialog = page.getByRole('dialog', {
    name: `${knockout.team_a} vs ${knockout.team_b}`,
    exact: true,
  })
  const scores = dialog.getByRole('region', { name: 'Score detail' })
  await expect(scores).toContainText('Full-time (source)')
  await expect(scores).toContainText('1 – 1')
  await expect(scores).toContainText('Half-time (source)')
  await expect(scores).toContainText('1 – 0')
  await expect(scores).toContainText('Penalties (source)')
  await expect(scores).toContainText('4 – 3')
  await expect(scores).toContainText('90-minute outcome is not guaranteed')
  await capture(page, testInfo, `open-football-knockout-${testInfo.project.name}.png`, false)
  await noPageOverflow(page)
  await dialog.getByRole('button', { name: /Copa Libertadores 2025/ }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/research_edition=libertadores-2025/)
  await expect(
    page.getByRole('heading', { name: 'Copa Libertadores 2025', exact: true }),
  ).toBeVisible()
  await navigate(page, 'Match center')
  await expect(page.getByRole('heading', { name: 'Match center.', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect match / })).not.toHaveCount(0)
  assertStaticIsolation(requests, live)
})
