import type { Page, Route } from '@playwright/test'
import type { LiveHealth, LiveMatch, LiveProvider } from '../src/live'
import type { LiveAnswer, LiveAsk } from '../src/liveChat'
import { test, expect } from './fixtures'
import { capture, noPageOverflow } from './journeys'

// Controlled transport fixtures exercise provenance and UI races. They are not
// provider publications, native-model results or generated public assets.
const boardVersion = 'ab'.repeat(8),
  boardFingerprint = 'cd'.repeat(32)
const capturedVersion = 'ef'.repeat(8),
  capturedFingerprint = '01'.repeat(32)
const cutoff = '2026-10-06T12:00:00.000000Z',
  captureCutoff = '2026-10-06T11:59:00.000000Z'
function health(provider: LiveProvider): LiveHealth {
  return {
    provider,
    data_kind: 'api',
    status: 'ready',
    producer_status: 'ready',
    snapshot_available: true,
    dataset_version: boardVersion,
    snapshot_fingerprint: boardFingerprint,
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
      attempted: 1,
      succeeded: 1,
      failed: 0,
      awaiting_credentials: 0,
      quota_limited: 0,
      interrupted: 0,
    },
    last_poll: { source_rows: 1, changed_rows: 0, unsupported_rows: 0, requests: 1 },
    capabilities: {
      tier: 'free',
      update_mode: 'polled_rest',
      scores_delayed: provider === 'football-data' ? true : null,
      fixtures_and_results: true,
      in_game_round_feed: false,
    },
    request_budget: { limit: 10, window_seconds: 60, used: 1, remaining: 9 },
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
    coverage_scope: 'Controlled test scope only; not complete provider coverage.',
    update_mode: 'polled_rest',
    in_game_round_feed: false,
    predictions_available: false,
  }
}
function match(provider: LiveProvider): LiveMatch {
  return {
    event_id: `${provider}:101:1`,
    match_id: `${provider}:101`,
    provider,
    sport: provider === 'football-data' ? 'football' : 'valorant',
    competition: 'Controlled Chat Fixture',
    revision: 1,
    team_a_id: `${provider}:10`,
    team_a: provider === 'football-data' ? 'Fixture Football A' : 'Fixture VAL A',
    team_b_id: `${provider}:20`,
    team_b: provider === 'football-data' ? 'Fixture Football B' : 'Fixture VAL B',
    start_time: '2026-10-07T18:00:00.000000Z',
    observed_at: cutoff,
    completed_at: null,
    status: 'scheduled',
    score_a: provider === 'football-data' ? null : 0,
    score_b: provider === 'football-data' ? null : 0,
    best_of: provider === 'football-data' ? 1 : 3,
  }
}
function answer(request: LiveAsk): LiveAnswer {
  const expectedFingerprint = request.snapshot_fingerprint || capturedFingerprint,
    expectedVersion = expectedFingerprint === boardFingerprint ? boardVersion : capturedVersion,
    expectedCutoff = expectedFingerprint === boardFingerprint ? cutoff : captureCutoff
  const captured = {
    ...health(request.provider),
    dataset_version: expectedVersion,
    snapshot_fingerprint: expectedFingerprint,
    as_of: expectedCutoff,
    cutoff: expectedCutoff,
  }
  const shared = {
    provider: request.provider,
    dataset_version: expectedVersion,
    snapshot_fingerprint: expectedFingerprint,
    cutoff: expectedCutoff,
  }
  const result: LiveAnswer = {
    ...captured,
    answer: `Controlled ${request.mode === 'evidence' ? 'evidence' : 'model transport'} for ${request.provider}. This scheduled match has no confirmed completed result.`,
    mode: request.mode,
    abstained: false,
    trace_id: 'ab'.repeat(16),
    contract_version: '2.0',
    prompt_version: 'controlled-browser-test',
    model: request.mode === 'ollama' ? 'controlled-model-fixture' : null,
    model_digest: null,
    metrics: {
      latency_seconds: 1,
      generated_tokens: request.mode === 'ollama' ? 10 : 0,
      tool_calls: 2,
    },
    grounding:
      'Captured source references validated; semantic factual support requires separate evaluation.',
    tool_results: [
      {
        tool: 'live_quality',
        source: 'LIVE_STATUS.json',
        citation_id: `${request.provider}:${expectedFingerprint}:LIVE_STATUS.json`,
        ...shared,
        rows: [{ health: captured, retained_matches: 1 }],
      },
      {
        tool: 'live_match',
        source: 'gold/matches.parquet',
        citation_id: `${request.provider}:${expectedFingerprint}:gold/matches.parquet`,
        ...shared,
        rows: [
          { ...match(request.provider), match_id: request.match_id, observed_at: expectedCutoff },
        ],
        result_known: false,
        score_unit: request.provider === 'football-data' ? 'goals' : 'maps',
        score_interpretation:
          'Unconfirmed source score fields; not a completed result, including any stored 0-0.',
        history_basis: 'Current retained revision only.',
      },
    ],
    citations: [],
  }
  result.citations = result.tool_results.map((tool) => ({
    id: tool.citation_id!,
    source: tool.source!,
    provider: request.provider,
    dataset_version: expectedVersion,
    snapshot_fingerprint: expectedFingerprint,
    uri: `snapshot://${request.provider}/${expectedVersion}/${expectedFingerprint}/${tool.source}`,
  }))
  return result
}
async function transport(
  page: Page,
  chat: (body: LiveAsk, route: Route) => Promise<void>,
  feedback: (body: unknown) => void = () => {},
  currentFingerprint: () => string = () => boardFingerprint,
) {
  await page.route('**/api/live/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.pathname.endsWith('/chat')) return chat(request.postDataJSON() as LiveAsk, route)
    if (url.pathname.endsWith('/feedback')) {
      const body = request.postDataJSON()
      feedback(body)
      return route.fulfill({
        json: { status: 'saved', provider: body.provider, trace_id: body.trace_id },
      })
    }
    const provider =
      url.searchParams.get('provider') === 'pandascore' ? 'pandascore' : 'football-data'
    const meta = { ...health(provider), snapshot_fingerprint: currentFingerprint() }
    if (url.pathname.endsWith('/health')) return route.fulfill({ json: meta })
    if (!url.pathname.endsWith('/matches'))
      return route.fulfill({ json: { ...meta, match: match(provider) } })
    const status = url.searchParams.get('status'),
      rows = !status || status === 'scheduled' ? [match(provider)] : []
    return route.fulfill({ json: { ...meta, rows, total: rows.length, limit: 25, offset: 0 } })
  })
}
async function openPanel(page: Page, provider: LiveProvider = 'pandascore') {
  await page.goto(
    `./?view=live&live_workspace=canonical&live_provider=${provider}&live_status=scheduled`,
  )
  await page.getByRole('button', { name: /^Inspect current match / }).click()
  await page.getByText('Ask about this match', { exact: true }).click()
  return page.getByRole('region', { name: 'Ask about this current match', exact: true })
}

test('captured match evidence keeps its own source version, score meaning, citations and feedback', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled local chat transport only.')
  const requests: LiveAsk[] = [],
    saved: unknown[] = []
  let corrupt: 'none' | 'citation' | 'tool' = 'none'
  await transport(
    page,
    async (body, route) => {
      requests.push(body)
      const result = answer(body)
      if (corrupt === 'citation') result.citations[0].snapshot_fingerprint = capturedFingerprint
      if (corrupt === 'tool') result.tool_results[1].snapshot_fingerprint = capturedFingerprint
      await route.fulfill({ json: result })
    },
    (body) => saved.push(body),
  )
  const panel = await openPanel(page)
  await expect(panel.getByRole('radio', { name: 'Evidence mode', exact: true })).toBeChecked()
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  const result = panel.getByRole('region', { name: 'Current match answer', exact: true })
  await expect(result).toContainText('No model called')
  await expect(result).toContainText(boardVersion)
  await expect(result).not.toContainText('differs from the current match board')
  await expect(result).toContainText('12:00:00 UTC')
  expect(requests).toEqual([
    {
      provider: 'pandascore',
      match_id: 'pandascore:101',
      question: 'Explain this match status and whether its score is a confirmed result.',
      mode: 'evidence',
      snapshot_fingerprint: boardFingerprint,
    },
  ])
  await result
    .getByRole('button', { name: 'Inspect current source gold/matches.parquet', exact: true })
    .click()
  const evidence = result.getByRole('region', {
    name: 'Current answer evidence live_match',
    exact: true,
  })
  await expect(evidence).toContainText('Unconfirmed source score fields')
  await evidence.getByText('Structured records · 1', { exact: true }).click()
  await expect(evidence).toContainText('"score_a": 0')
  await expect(evidence).toContainText('"result_known": false')
  await expect(result).toContainText(boardFingerprint)
  await expect(result).toContainText('Provider health at capture')
  await result
    .getByRole('textbox', { name: 'Current answer feedback comment' })
    .fill('Clear source limits.')
  await result.getByRole('button', { name: 'Helpful current answer', exact: true }).click()
  await expect(result.getByRole('status')).toContainText(
    'Feedback saved for this captured provider trace.',
  )
  expect(saved).toEqual([
    {
      provider: 'pandascore',
      trace_id: 'ab'.repeat(16),
      snapshot_fingerprint: boardFingerprint,
      rating: 1,
      comment: 'Clear source limits.',
    },
  ])
  await page.setViewportSize({ width: 390, height: 844 })
  await noPageOverflow(page)
  await capture(page, testInfo, 'current-answer-fixture-mobile.png', false)
  corrupt = 'citation'
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('failed its captured-source contract')
  await expect(result).toHaveCount(0)
  corrupt = 'tool'
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect.poll(() => requests.length).toBe(3)
  await expect(panel.getByRole('alert')).toContainText('failed its captured-source contract')
  await expect(result).toHaveCount(0)
})

test('a local capture conflict keeps the refresh-required error and never retries another mode', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled capture conflict only.')
  const requests: LiveAsk[] = []
  await page.clock.install({ time: new Date('2026-10-06T12:01:00Z') })
  await transport(page, async (body, route) => {
    requests.push(body)
    await route.fulfill({ status: 409, json: { detail: 'Controlled publication changed' } })
  })
  const panel = await openPanel(page)
  await panel.getByRole('radio', { name: 'Local AI mode', exact: true }).check()
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText(
    'Refresh this validated record before asking again',
  )
  await expect(panel.getByRole('button', { name: 'Retry selected mode' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Ask current match' })).toBeDisabled()
  await expect(panel.getByRole('region', { name: 'Current match answer' })).toHaveCount(0)
  await page.clock.fastForward(8001)
  await expect(panel.getByRole('alert')).toContainText('selected publication changed')
  await panel.getByRole('radio', { name: 'Evidence mode', exact: true }).check()
  await expect(panel.getByRole('button', { name: 'Ask current match' })).toBeDisabled()
  expect(requests.map((request) => [request.mode, request.snapshot_fingerprint])).toEqual([
    ['ollama', boardFingerprint],
  ])
})

test('an internally consistent answer from another capture is rejected against the pinned request', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled wrong-capture answer only.')
  const requests: LiveAsk[] = []
  await transport(page, async (body, route) => {
    requests.push(body)
    await route.fulfill({ json: answer({ ...body, snapshot_fingerprint: capturedFingerprint }) })
  })
  const panel = await openPanel(page)
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('selected publication changed')
  await expect(panel.getByRole('region', { name: 'Current match answer' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Retry selected mode' })).toHaveCount(0)
  expect(requests[0].snapshot_fingerprint).toBe(boardFingerprint)
})

test('an answer pinned before a later board refresh retains its original verified capture', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled pinned in-flight capture only.')
  let release!: () => void,
    latestFingerprint = boardFingerprint
  const gate = new Promise<void>((resolve) => {
      release = resolve
    }),
    requests: LiveAsk[] = []
  await page.clock.install({ time: new Date('2026-10-06T12:01:00Z') })
  await transport(
    page,
    async (body, route) => {
      requests.push(body)
      await gate
      await route.fulfill({ json: answer(body) })
    },
    () => {},
    () => latestFingerprint,
  )
  const panel = await openPanel(page)
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  latestFingerprint = capturedFingerprint
  await page.clock.fastForward(8001)
  await expect(page.getByRole('region', { name: 'Current match provenance' })).toContainText(
    capturedFingerprint,
  )
  release()
  const result = panel.getByRole('region', { name: 'Current match answer' })
  await expect(result).toContainText(boardFingerprint)
  await expect(result).toContainText('differs from the current match board')
  expect(requests[0].snapshot_fingerprint).toBe(boardFingerprint)
})

test('a question cancelled by provider navigation cannot overwrite the new match answer', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled provider race only.')
  let release!: () => void, finished!: () => void
  const gate = new Promise<void>((resolve) => {
      release = resolve
    }),
    done = new Promise<void>((resolve) => {
      finished = resolve
    })
  const requests: LiveAsk[] = []
  await transport(page, async (body, route) => {
    requests.push(body)
    if (body.provider === 'football-data') {
      await gate
      try {
        await route.fulfill({ json: answer(body) })
      } catch {
        /* The old browser request was cancelled. */
      } finally {
        finished()
      }
    } else await route.fulfill({ json: answer(body) })
  })
  const first = await openPanel(page, 'football-data')
  await first.getByRole('radio', { name: 'Local AI mode', exact: true }).check()
  await first.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Cancel current question' })).toBeVisible()
  await expect.poll(() => requests.length).toBe(1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'VALORANT provider PandaScore', exact: true }).click()
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click()
  await page.getByRole('button', { name: /^Inspect current match / }).click()
  await page.getByText('Ask about this match', { exact: true }).click()
  const next = page.getByRole('region', { name: 'Ask about this current match', exact: true })
  await next.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(next.getByRole('region', { name: 'Current match answer' })).toContainText(
    'Controlled evidence for pandascore',
  )
  release()
  await done
  await expect(next.getByRole('region', { name: 'Current match answer' })).not.toContainText(
    'Controlled model transport for football-data',
  )
  expect(requests.map((row) => [row.provider, row.mode, row.match_id])).toEqual([
    ['football-data', 'ollama', 'football-data:101'],
    ['pandascore', 'evidence', 'pandascore:101'],
  ])
})

test('local model busy and unavailable responses keep the selected mode until an explicit evidence retry', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled local service errors only.')
  const requests: LiveAsk[] = []
  await transport(page, async (body, route) => {
    requests.push(body)
    if (requests.length <= 2)
      await route.fulfill({
        status: requests.length === 1 ? 429 : 503,
        json: { detail: 'Controlled model error' },
      })
    else await route.fulfill({ json: answer(body) })
  })
  const panel = await openPanel(page)
  await panel.getByRole('radio', { name: 'Local AI mode', exact: true }).check()
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('local model is busy (429)')
  await expect(panel.getByRole('radio', { name: 'Local AI mode', exact: true })).toBeChecked()
  await panel.getByRole('button', { name: 'Retry selected mode', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('unavailable (503)')
  expect(requests.map((row) => row.mode)).toEqual(['ollama', 'ollama'])
  await expect(panel.getByRole('region', { name: 'Current match answer' })).toHaveCount(0)
  await panel.getByRole('radio', { name: 'Evidence mode', exact: true }).check()
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect(panel.getByRole('region', { name: 'Current match answer' })).toContainText(
    'No model called',
  )
  expect(requests.map((row) => row.mode)).toEqual(['ollama', 'ollama', 'evidence'])
})

test('local question cancellation and the browser deadline cannot render a delayed response', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'live-desktop', 'Controlled local deadline only.')
  const releases: Array<() => void> = [],
    requests: LiveAsk[] = []
  await transport(page, async (body, route) => {
    requests.push(body)
    await new Promise<void>((resolve) => releases.push(resolve))
    try {
      await route.fulfill({ json: answer(body) })
    } catch {
      /* Intentionally aborted transport. */
    }
  })
  await page.clock.install({ time: new Date('2026-10-06T12:01:00Z') })
  const panel = await openPanel(page)
  await panel.getByRole('radio', { name: 'Local AI mode', exact: true }).check()
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect.poll(() => releases.length).toBe(1)
  await panel.getByRole('button', { name: 'Cancel current question', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Cancelled in this browser')
  releases[0]()
  await expect(panel.getByRole('region', { name: 'Current match answer' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Ask current match', exact: true }).click()
  await expect.poll(() => releases.length).toBe(2)
  await page.clock.fastForward(200001)
  await expect(panel.getByRole('alert')).toContainText('stopped waiting after 200 seconds')
  releases[1]()
  await expect(panel.getByRole('region', { name: 'Current match answer' })).toHaveCount(0)
  expect(requests.map((row) => row.mode)).toEqual(['ollama', 'ollama'])
})

test('public current-match AI remains unavailable without API probes or synthetic substitution', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'live-desktop', 'Published Pages mode only.')
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(
    './?view=live&live_workspace=canonical&live_provider=pandascore&live_match=pandascore%3A101',
  )
  await expect(page.getByRole('region', { name: 'Live connection unavailable' })).toContainText(
    'Current-match AI and feedback are unavailable',
  )
  await expect(page.getByRole('button', { name: 'Ask current match' })).toHaveCount(0)
  await noPageOverflow(page)
  expect(
    requests.filter(
      (url) =>
        new URL(url).pathname.startsWith('/api/') ||
        /\/(?:snapshot|open-football)\.json$/.test(new URL(url).pathname),
    ),
  ).toEqual([])
})
