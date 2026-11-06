import type { Page } from '@playwright/test'
import type { LiveHealth, LiveMatch, LiveProvider } from '../src/live'
import type { LiveAnswer, LiveAsk } from '../src/liveChat'
import { test, expect } from './fixtures'
import { capture, navigate, noPageOverflow } from './journeys'
import { opaqueMatchID, packageFixture } from './published-fixtures'

// These are controlled transport fixtures, never real provider data or public assets.
const cutoff = '2026-10-06T12:00:00.000000Z',
  version = 'ab'.repeat(8),
  fingerprint = 'cd'.repeat(32)
function health(provider: LiveProvider): LiveHealth {
  return {
    provider,
    data_kind: 'api',
    status: 'ready',
    producer_status: 'ready',
    snapshot_available: true,
    dataset_version: version,
    snapshot_fingerprint: fingerprint,
    as_of: cutoff,
    cutoff,
    generated_at: cutoff,
    last_attempt_at: '2026-10-06T12:01:00.000000Z',
    last_success_at: '2026-10-06T12:01:00.000000Z',
    last_change_at: cutoff,
    poll_interval_seconds: 60,
    poll_age_seconds: 0,
    stale_after_seconds: 120,
    stale: false,
    serving_last_good: false,
    publication_error_code: null,
    last_error_code: null,
    poll_counts: {
      attempted: 2,
      succeeded: 2,
      failed: 0,
      awaiting_credentials: 0,
      quota_limited: 0,
      interrupted: 0,
    },
    last_poll: { source_rows: 27, changed_rows: 0, unsupported_rows: 0, requests: 1 },
    capabilities: {
      tier: 'free',
      update_mode: 'polled_rest',
      scores_delayed: provider === 'football-data' ? true : null,
      fixtures_and_results: true,
      in_game_round_feed: false,
    },
    request_budget: {
      limit: provider === 'football-data' ? 10 : 1000,
      window_seconds: provider === 'football-data' ? 60 : 3600,
      used: 1,
      remaining: provider === 'football-data' ? 9 : 999,
    },
    source_scope:
      provider === 'football-data'
        ? { kind: 'competition_list', competition_codes: ['PL'], phases: [], pages: 1 }
        : {
            kind: 'match_phases',
            competition_codes: [],
            phases: ['past', 'upcoming', 'running'],
            pages: 1,
          },
    freshness_scope: 'declared_poll_scope',
    coverage_scope: 'Controlled test scope. A successful check does not update every retained row.',
    update_mode: 'polled_rest',
    in_game_round_feed: false,
    predictions_available: false,
  }
}
function fixture(provider: LiveProvider): LiveMatch[] {
  const sport = provider === 'football-data' ? 'football' : 'valorant'
  const count = provider === 'football-data' ? 26 : 1
  const scheduled = Array.from(
    { length: count },
    (_, index) =>
      ({
        event_id: `test:${provider}:${index}:1`,
        match_id: `test:${provider}:${index}`,
        provider,
        sport,
        competition:
          provider === 'football-data' ? 'Controlled Fixture League' : 'Controlled Fixture Series',
        revision: 1,
        team_a_id: `${provider}:fixture-a${index}`,
        team_a: provider === 'football-data' ? `Fixture United ${index + 1}` : 'Fixture Alpha',
        team_b_id: `${provider}:fixture-b${index}`,
        team_b: provider === 'football-data' ? `Fixture City ${index + 1}` : 'Fixture Omega',
        start_time: `2026-10-07T${String(10 + Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}:00.000000Z`,
        observed_at: cutoff,
        completed_at: null,
        status: 'scheduled',
        score_a: provider === 'pandascore' ? 0 : null,
        score_b: provider === 'pandascore' ? 0 : null,
        best_of: provider === 'pandascore' ? 3 : 1,
      }) as LiveMatch,
  )
  return [
    ...scheduled,
    {
      ...scheduled[0],
      event_id: `test:${provider}:finished:1`,
      match_id: `test:${provider}:finished`,
      start_time: '2026-10-05T18:00:00.000000Z',
      completed_at: '2026-10-05T20:00:00.000000Z',
      status: 'finished',
      score_a: provider === 'pandascore' ? 2 : 3,
      score_b: 1,
    },
  ]
}
type Mode =
  | 'healthy'
  | 'new-check'
  | 'failed'
  | 'mismatch'
  | 'wrong-provider'
  | 'invalid-publication'
  | 'detail-failed'
async function transport(page: Page, getMode: () => Mode = () => 'healthy') {
  let checks = 0
  await page.route('**/api/live/**', async (route) => {
    const url = new URL(route.request().url()),
      requested = url.searchParams.get('provider') as LiveProvider
    const provider = requested === 'pandascore' ? 'pandascore' : 'football-data',
      mode = getMode()
    if (mode === 'failed')
      return route.fulfill({ status: 503, json: { detail: 'Controlled backend unavailable' } })
    const base = health(
      mode === 'wrong-provider' && url.pathname.endsWith('/matches') ? 'football-data' : provider,
    )
    if (mode === 'new-check') {
      base.last_attempt_at = '2026-10-06T12:01:04.000000Z'
      base.last_success_at = '2026-10-06T12:01:05.000000Z'
    }
    if (mode === 'invalid-publication') {
      base.status = 'invalid_publication'
      base.serving_last_good = true
      base.stale = true
      base.publication_error_code = 'snapshot_checksum_mismatch'
    }
    if (url.pathname.endsWith('/health')) {
      checks++
      if (mode === 'mismatch') {
        base.dataset_version = 'ef'.repeat(8)
        base.snapshot_fingerprint = '01'.repeat(32)
      }
      return route.fulfill({ json: base })
    }
    let all = fixture(base.provider)
    if (mode === 'detail-failed' && !url.pathname.endsWith('/matches'))
      return route.fulfill({ status: 503, json: { detail: 'Controlled detail unavailable' } })
    if (!url.pathname.endsWith('/matches'))
      return route.fulfill({
        json: {
          ...base,
          match:
            all.find(
              (row) => row.match_id === decodeURIComponent(url.pathname.split('/').at(-1)!),
            ) || null,
        },
      })
    const status = url.searchParams.get('status'),
      search = url.searchParams.get('search')?.toLowerCase(),
      offset = Number(url.searchParams.get('offset') || 0)
    if (status) all = all.filter((row) => row.status === status)
    if (search)
      all = all.filter((row) =>
        `${row.team_a} ${row.team_b} ${row.competition}`.toLowerCase().includes(search),
      )
    all.sort((a, b) =>
      url.searchParams.get('order') === 'asc'
        ? a.start_time.localeCompare(b.start_time)
        : b.start_time.localeCompare(a.start_time),
    )
    return route.fulfill({
      json: { ...base, rows: all.slice(offset, offset + 25), total: all.length, limit: 25, offset },
    })
  })
  return () => checks
}

function localAnswer(request: LiveAsk, meta: LiveHealth, match: LiveMatch): LiveAnswer {
  const citationID = `${request.provider}:${meta.snapshot_fingerprint}:gold/matches.parquet`
  return {
    ...meta,
    answer: 'Controlled captured evidence. This scheduled match has no confirmed completed result.',
    mode: request.mode,
    abstained: false,
    trace_id: 'ab'.repeat(16),
    contract_version: '2.0',
    prompt_version: 'controlled-browser-test',
    model: null,
    model_digest: null,
    metrics: { latency_seconds: 1, generated_tokens: 0, tool_calls: 1 },
    grounding: 'Captured source references validated; factual support needs separate evaluation.',
    tool_results: [
      {
        tool: 'live_match',
        source: 'gold/matches.parquet',
        citation_id: citationID,
        provider: request.provider,
        dataset_version: meta.dataset_version,
        snapshot_fingerprint: meta.snapshot_fingerprint,
        cutoff: meta.cutoff,
        rows: [{ ...match }],
        result_known: false,
        score_unit: 'maps',
        score_interpretation: 'Unconfirmed source scores are not a completed result.',
        history_basis: 'Current retained revision only.',
      },
    ],
    citations: [
      {
        id: citationID,
        source: 'gold/matches.parquet',
        provider: request.provider,
        dataset_version: meta.dataset_version!,
        snapshot_fingerprint: meta.snapshot_fingerprint!,
        uri: `snapshot://${request.provider}/${meta.dataset_version}/${meta.snapshot_fingerprint}/gold/matches.parquet`,
      },
    ],
  }
}

test('local processed envelope validates identity links and pins canonical detail and chat to their capture', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled local processed transport only.')
  let changed = false,
    invalidLink: 'none' | 'fingerprint' | 'swapped' | 'nonnumeric' = 'none'
  const requests: string[] = [],
    asks: LiveAsk[] = [],
    selectedID = opaqueMatchID('pandascore', 'pandascore:101')
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  await page.clock.install({ time: new Date('2026-10-06T12:01:05Z') })
  await page.route('**/api/live/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/display')) {
      const nonnumeric = invalidLink === 'nonnumeric',
        bundle = packageFixture(nonnumeric ? 'v2-local-nonnumeric' : 'v2-local'),
        matchIDs = nonnumeric
          ? ['pandascore:fixture-0', 'pandascore:fixture-1']
          : ['pandascore:101', 'pandascore:102']
      return route.fulfill({
        json: {
          manifest_json: bundle.bodies['manifest.json'],
          provider_json: {
            'football-data': bundle.bodies['football-data.json'],
            pandascore: bundle.bodies['pandascore.json'],
          },
          canonical_links: {
            'football-data': {},
            pandascore: Object.fromEntries(
              matchIDs.map((matchID, i) => [
                opaqueMatchID('pandascore', matchID),
                {
                  match_id: invalidLink === 'swapped' ? matchIDs[1 - i] : matchID,
                  snapshot_fingerprint:
                    invalidLink === 'fingerprint' ? 'ef'.repeat(32) : fingerprint,
                },
              ]),
            ),
          },
          captured_at: '2026-10-06T12:00:00.000000Z',
        },
      })
    }
    const chatBody = url.pathname.endsWith('/chat')
        ? (route.request().postDataJSON() as LiveAsk)
        : undefined,
      provider =
        (chatBody?.provider || url.searchParams.get('provider')) === 'pandascore'
          ? 'pandascore'
          : 'football-data',
      meta = { ...health(provider), snapshot_fingerprint: changed ? 'ef'.repeat(32) : fingerprint },
      rows = fixture(provider).map((row, i) => ({
        ...row,
        match_id: `${provider}:${101 + i}`,
        event_id: `${provider}:${101 + i}:1`,
        team_a_id: `${provider}:10`,
        team_b_id: `${provider}:20`,
      }))
    if (chatBody) {
      asks.push(chatBody)
      return route.fulfill({ json: localAnswer(chatBody, meta, rows[0]) })
    }
    if (url.pathname.endsWith('/health')) return route.fulfill({ json: meta })
    if (url.pathname.endsWith('/matches'))
      return route.fulfill({ json: { ...meta, rows, total: rows.length, limit: 25, offset: 0 } })
    return route.fulfill({ json: { ...meta, match: rows[0] } })
  })
  await page.goto('./?view=live&live_provider=pandascore&live_status=all')
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(8)
  await page.locator('[data-display-id="pandascore-0000000000000424"]').click()
  await expect(page.getByRole('dialog')).toContainText('No validated record or AI context')
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Inspect validated record' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  for (const invalid of ['fingerprint', 'swapped', 'nonnumeric'] as const) {
    invalidLink = invalid
    const refresh = page.getByRole('button', { name: 'Refresh current provider' })
    await refresh.click()
    await expect(refresh).toBeEnabled()
    await expect(page.getByRole('alert')).toContainText('last verified display package')
    await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(8)
    await expect(page.locator(`[data-display-id="${selectedID}"]`)).toHaveCount(1)
  }
  invalidLink = 'none'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.locator(`[data-display-id="${selectedID}"]`).click()
  await page.getByRole('button', { name: 'Inspect validated record', exact: true }).click()
  await expect(page).toHaveURL(/live_workspace=canonical/)
  await expect(page).toHaveURL(/live_match=pandascore%3A101/)
  await expect(page).toHaveURL(new RegExp(`live_canonical_fingerprint=${fingerprint}`))
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Fixture Alpha vs Fixture Omega' })).toBeVisible()
  await page.getByText('Ask about this match', { exact: true }).click()
  const chat = page.getByRole('region', { name: 'Ask about this current match', exact: true })
  await chat.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(chat.getByRole('region', { name: 'Current match answer' })).toContainText(
    'Controlled captured evidence',
  )
  expect(asks).toMatchObject([
    {
      provider: 'pandascore',
      match_id: 'pandascore:101',
      snapshot_fingerprint: fingerprint,
      mode: 'evidence',
    },
  ])
  changed = true
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText('validated record publication changed')
  await expect(page.getByRole('button', { name: 'Ask current match' })).toHaveCount(0)
  expect(requests.filter((path) => /\/live\/chat$/.test(path))).toHaveLength(1)
  expect(requests.filter((path) => /\/live\/feedback|\/current\//.test(path))).toEqual([])
})

test('current provider board keeps bounded paging, URL identity and scheduled default scores distinct from results', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled local provider transport only.')
  await transport(page)
  await page.goto('./?view=live&live_workspace=canonical')
  await expect(
    page.getByRole('heading', { name: 'No running matches in this publication.', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /^Football data provided by the Football-Data.org API/ }),
  ).toHaveAttribute('href', 'https://www.football-data.org/')
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: /^26 matching provider matches$/ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(25)
  await page.getByRole('button', { name: 'Next current matches page' }).click()
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search current matches' }).fill('Fixture United 2')
  await expect(page).toHaveURL(/live_page=0/)
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(8)
  await page.getByRole('button', { name: 'VALORANT provider PandaScore', exact: true }).click()
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click()
  const trigger = page.getByRole('button', {
    name: /^Inspect current match Fixture Alpha vs Fixture Omega,/,
  })
  await expect(page.getByRole('link', { name: /^Source: PandaScore/ })).toHaveAttribute(
    'href',
    'https://pandascore.co/',
  )
  await expect(trigger).toBeVisible()
  await expect(trigger.getByLabel('Provider score unavailable', { exact: true })).toBeVisible()
  await expect(trigger).not.toContainText('0 : 0')
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Fixture Alpha vs Fixture Omega', exact: true })
  await expect(dialog.getByRole('region', { name: 'Current match scoreboard' })).toContainText(
    '— : —',
  )
  await expect(dialog.getByRole('region', { name: 'Current match provenance' })).toContainText(
    '0 : 0',
  )
  await expect(dialog).toContainText('does not establish play or a completed result')
  await expect(dialog).toContainText('pandascore:fixture-a0')
  await expect(page).toHaveURL(/live_match=test%3Apandascore%3A0/)
  await page.reload()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Finished', exact: true }).click()
  await page
    .getByRole('button', { name: /^Inspect current match / })
    .first()
    .click()
  await expect(dialog.getByRole('region', { name: 'Current match scoreboard' })).toContainText(
    '2 : 1',
  )
  await expect(dialog.getByRole('region', { name: 'Current match scoreboard' })).toContainText(
    'series maps · BO3',
  )
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await noPageOverflow(page)
  await capture(page, testInfo, 'current-provider-fixture-mobile.png', false)
})

test('backend polling keeps last good rows through failures and rejects mismatched publications and provider races', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'live-desktop',
    'Controlled local refresh and failure scenarios only.',
  )
  let mode: Mode = 'healthy'
  const checked = await transport(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:01:00Z') })
  await page.goto('./?view=live&live_workspace=canonical&live_status=scheduled')
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(25)
  const panel = page.getByRole('region', { name: 'Provider collection health' })
  const cutoffBefore = await panel
    .getByText('Dataset observation cutoff', { exact: true })
    .locator('..')
    .textContent()
  mode = 'new-check'
  await page.clock.runFor(8100)
  await expect.poll(checked).toBeGreaterThan(1)
  await expect(panel).toContainText('12:01:05 UTC')
  expect(
    await panel
      .getByText('Dataset observation cutoff', { exact: true })
      .locator('..')
      .textContent(),
  ).toBe(cutoffBefore)
  mode = 'failed'
  await page.clock.runFor(8100)
  await expect(page.getByRole('alert')).toContainText('request failed (503)')
  await expect(panel).toContainText('Refresh failed · last verified data')
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(25)
  mode = 'mismatch'
  await page.getByRole('button', { name: 'Refresh current provider', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('publication changed during this check')
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(25)
  mode = 'invalid-publication'
  await page.getByRole('button', { name: 'Refresh current provider', exact: true }).click()
  await expect(panel).toContainText('Serving last verified data')
  await expect(
    page.getByRole('status').filter({ hasText: /invalid publication was rejected/i }),
  ).toBeVisible()
  await page.getByText('Inspect provider health evidence', { exact: true }).click()
  await expect(panel).toContainText('snapshot_checksum_mismatch')
  mode = 'wrong-provider'
  await page.getByRole('button', { name: 'VALORANT provider PandaScore', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('failed its provider contract')
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'No verified provider publication.', exact: true }),
  ).toBeVisible()
})

test('current match deep links retry detail failures while preserving version-scoped evidence', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled local detail refresh only.')
  let mode: Mode = 'healthy'
  await transport(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:01:00Z') })
  await page.goto(
    './?view=live&live_workspace=canonical&live_provider=pandascore&live_status=finished&live_match=test%3Apandascore%3A0',
  )
  const dialog = page.getByRole('dialog', { name: 'Fixture Alpha vs Fixture Omega', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Current match scoreboard' })).toContainText(
    '\u2014 : \u2014',
  )
  await expect(dialog.getByRole('region', { name: 'Current match provenance' })).toContainText(
    fingerprint,
  )
  mode = 'detail-failed'
  await page.clock.runFor(8100)
  await expect(dialog).toContainText('request failed (503)')
  await expect(dialog.getByRole('region', { name: 'Current match provenance' })).toContainText(
    fingerprint,
  )
  mode = 'healthy'
  await page.clock.runFor(8100)
  await expect(dialog).not.toContainText('request failed (503)')
  await expect(dialog.getByRole('region', { name: 'Current match scoreboard' })).toContainText(
    '\u2014 : \u2014',
  )
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('public current workspace never probes provider APIs or substitutes stored fixtures as live data', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'live-desktop', 'Published Pages mode only.')
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('./?view=live&live_workspace=canonical')
  await expect(
    page.getByRole('region', { name: 'Live connection unavailable', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Live connection unavailable.', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Refresh current provider', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'VALORANT provider PandaScore', exact: true }).click()
  await expect(page).toHaveURL(/live_provider=pandascore/)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'VALORANT provider PandaScore', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('region', { name: 'Live connection unavailable', exact: true }),
  ).toContainText('No stored dataset is presented as live')
  await expect(page.getByRole('button', { name: /^Inspect current match / })).toHaveCount(0)
  await noPageOverflow(page)
  await capture(page, testInfo, `current-provider-unavailable-${testInfo.project.name}.png`, false)
  expect(
    requests.filter(
      (url) =>
        new URL(url).pathname.startsWith('/api/') ||
        url.endsWith('/snapshot.json') ||
        url.endsWith('/open-football.json'),
    ),
  ).toEqual([])
  await navigate(page, 'Open football')
  await expect(page.getByRole('heading', { name: 'Open football.', exact: true })).toBeVisible()
})
