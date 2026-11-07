import { packageFixture } from './published-fixtures'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { capture, noPageOverflow } from './journeys'

async function intercept(page: Page, getMode: () => string = () => 'valid') {
  let manifests = 0
  await page.route('**/current/*.json', async (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1)!,
      mode = getMode(),
      bundle = packageFixture(mode)
    if (filename === 'manifest.json') manifests++
    if (mode === 'failed') return route.fulfill({ status: 503, body: 'TEST ONLY unavailable' })
    if (mode === 'oversized') return route.fulfill({ body: ' '.repeat(65537) })
    let body = bundle.bodies[filename]
    if (mode === 'tampered' && filename === 'pandascore.json') body += '!'
    if (mode === 'race' && filename === 'manifest.json' && manifests % 2 === 0)
      body = JSON.stringify({ ...bundle.manifest, generated_at: '2026-10-06T12:00:02.000000Z' })
    await route.fulfill({ contentType: 'application/json', body })
  })
  return () => manifests
}
async function clockAndOpen(page: Page) {
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto('./?view=live&live_status=scheduled')
}

for (const requestedPage of [1, 999]) {
  test(`a page ${requestedPage} deep link waits for verified data before clamping`, async ({ page }) => {
    let release!: () => void
    const delayed = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/current/*.json', async (route) => {
      await delayed
      const filename = new URL(route.request().url()).pathname.split('/').at(-1)!
      await route.fulfill({ contentType: 'application/json', body: packageFixture().bodies[filename] })
    })
    await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
    await page.goto(`./?view=live&live_status=scheduled&live_page=${requestedPage}`, {
      waitUntil: 'domcontentloaded',
    })
    try {
      await expect(page.getByRole('heading', { name: 'Verifying published current matches…' })).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`live_page=${requestedPage}(?:&|$)`))
    } finally {
      release()
    }
    await expect(page.getByRole('status').filter({ hasText: /^26 matches$/ })).toBeVisible()
    await expect(page).toHaveURL(/live_page=1(?:&|$)/)
    await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(1)
  })
}

async function retainLastGoodForResealedStates(page: Page, invalidModes: string[]) {
  let mode = 'v2-valid'
  const manifests = await intercept(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto(
    './?view=live&live_provider=pandascore&live_status=all&live_tab=events&live_event=pandascore-000000000000138a',
  )
  const rows = page.getByRole('button', { name: /^Inspect published match / }),
    refresh = page.getByRole('button', { name: 'Refresh current provider' })
  await expect(rows).toHaveCount(5)
  const originalIDs = await rows.evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('data-display-id')),
  )
  for (const invalid of invalidModes) {
    mode = invalid
    const before = manifests()
    await refresh.click()
    await expect.poll(manifests).toBeGreaterThan(before)
    await expect(refresh).toBeEnabled()
    await expect(page.getByRole('alert')).toContainText('last verified display package')
    expect(
      await rows.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-display-id'))),
    ).toEqual(originalIDs)
    await expect(page.getByRole('heading', { name: 'Playoffs', exact: true })).toBeVisible()
  }
}

test('processed published cards keep windowed filters, derived identity, citations boundary and visible credits', async ({
  page,
}, testInfo) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await intercept(page)
  await clockAndOpen(page)
  await expect(page.getByRole('status').filter({ hasText: /^26 matches$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(25)
  await expect(
    page.getByRole('button', { name: /^Inspect published match / }).first(),
  ).toBeInViewport()
  await page.getByRole('button', { name: 'Next published matches page' }).click()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search published current matches' }).fill('Águila 2')
  await expect(page).toHaveURL(/live_page=0/)
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(8)
  await page.getByRole('button', { name: 'VALORANT published provider PandaScore' }).click()
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click()
  const trigger = page.getByRole('button', { name: /^Inspect published match / })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'TEST ONLY Águila 1 vs TEST ONLY City 1' })
  await expect(dialog.getByRole('region', { name: 'Published match scoreboard' })).toContainText(
    'Result unavailable',
  )
  await expect(dialog).toContainText('not an original provider match or event ID')
  await expect(dialog).toContainText('pandascore-00000000000003e8')
  await expect(dialog.getByRole('link', { name: /^Source: PandaScore/ })).toHaveAttribute(
    'href',
    'https://www.pandascore.co/',
  )
  await expect(dialog.getByRole('button', { name: 'Ask current match' })).toHaveCount(0)
  await dialog.getByText('Inspect processed display evidence', { exact: true }).click()
  await expect(dialog).toContainText('"display_id": "pandascore-00000000000003e8"')
  await expect(dialog).toContainText('"score_label": null')
  await noPageOverflow(page)
  await capture(page, testInfo, `processed-current-${testInfo.project.name}.png`, false)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.reload()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  expect(
    requests.filter((url) =>
      /\/api\/|\/gold\/|\/live\/chat|\/snapshot\.json|\/open-football\.json/.test(
        new URL(url).pathname,
      ),
    ),
  ).toEqual([])
})

test('source staleness increases with display time even when a newer build arrives', async ({
  page,
}) => {
  let mode = 'valid'
  const manifests = await intercept(page, () => mode)
  await clockAndOpen(page)
  const health = page.getByRole('region', { name: 'Published source health' })
  await expect(health).toContainText('Recent source check')
  await page.clock.fastForward(90000)
  await expect.poll(manifests).toBeGreaterThanOrEqual(3)
  await expect(health).toHaveAttribute('aria-busy', 'false')
  await expect(health).toContainText('Stale source check')
  await page.clock.fastForward(30000)
  mode = 'rebuilt-stale'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(health).toContainText('Stale source check')
  await health.getByText('Inspect published collection evidence', { exact: true }).click()
  await expect(health).toContainText('12:02:00 UTC')
  await expect(health).toContainText('11:59:30 UTC')
})

test('unchanged verified manifests reuse bodies and recover client errors without hiding source age', async ({
  page,
}) => {
  let mode = 'valid'
  const requests: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  const manifests = await intercept(page, () => mode)
  await clockAndOpen(page)
  const health = page.getByRole('region', { name: 'Published source health' })
  const bodies = () =>
    requests.filter((path) => /\/current\/(?:football-data|pandascore)\.json$/.test(path)).length
  await expect(health).toHaveAttribute('aria-busy', 'false')
  expect(bodies()).toBe(2)
  for (const action of ['scheduled refresh', 'manual refresh']) {
    const before = manifests()
    if (action === 'scheduled refresh') await page.clock.fastForward(60000)
    else await page.getByRole('button', { name: 'Refresh current provider' }).click()
    await expect.poll(manifests).toBeGreaterThan(before)
    await expect(health).toHaveAttribute('aria-busy', 'false')
    expect(bodies()).toBe(2)
  }
  mode = 'failed'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(page.getByRole('alert')).toContainText('last verified display package')
  mode = 'valid'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(health).toHaveAttribute('aria-busy', 'false')
  expect(bodies()).toBe(2)
  await page.clock.fastForward(60000)
  await expect(health).toContainText('Stale source check')
  expect(bodies()).toBe(2)
})

test('tampered, resealed invalid, mismatched and deploy-racing packages retain verified cards', async ({
  page,
}) => {
  let mode = 'valid'
  const manifests = await intercept(page, () => mode)
  await clockAndOpen(page)
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(25)
  for (const broken of [
    'tampered',
    'typed-invalid',
    'provider-mismatch',
    'scheduled-score',
    'race',
    'failed',
  ]) {
    mode = broken
    const before = manifests()
    await page.getByRole('button', { name: 'Refresh current provider' }).click()
    await expect.poll(manifests).toBeGreaterThan(before)
    await expect(page.getByRole('alert')).toContainText('last verified display package')
    await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(25)
  }
  mode = 'valid'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('an oversized initial publication yields no cards and no substitute data', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await intercept(page, () => 'oversized')
  await clockAndOpen(page)
  await expect(
    page.getByRole('heading', { name: 'Published display unavailable.', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(0)
  expect(
    requests.filter((url) =>
      /\/api\/|\/snapshot\.json|\/open-football\.json/.test(new URL(url).pathname),
    ),
  ).toEqual([])
})

test('v2 nullable opponents, precision and source results stay explicit through stable resolution', async ({
  page,
}) => {
  let mode = 'v2-valid'
  await intercept(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto('./?view=live&live_provider=pandascore&live_status=all')
  const rows = page.getByRole('button', { name: /^Inspect published match / })
  await expect(rows).toHaveCount(8)
  await expect(rows.first()).toBeInViewport()
  await expect(page.getByText('Unresolved UTC dates', { exact: true })).toBeVisible()
  const pending = page.locator('[data-display-id="pandascore-0000000000000424"]')
  await expect(pending).toContainText('Opponent pending')
  await expect(pending).toContainText('Source date · time unavailable')
  await pending.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('2026-10-08 · time unavailable')
  await expect(dialog).toContainText('Series format unavailable')
  await expect(dialog.getByRole('region', { name: 'Published match scoreboard' })).toContainText(
    'Result unavailable',
  )
  await expect(page).toHaveURL(/live_match=pandascore-0000000000000424/)
  mode = 'v2-resolved'
  await page.keyboard.press('Escape')
  await expect(pending).toBeFocused()
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(pending).toContainText('TEST ONLY City 1')
  await pending.click()
  await expect(page.getByRole('dialog')).toContainText('8 Oct 2026, 12:00:00 UTC')
  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pending).toBeFocused()
  await page.locator('[data-display-id="pandascore-0000000000000428"]').click()
  await expect(page.getByRole('dialog')).toContainText('Source-reported score')
  await expect(page.getByRole('dialog')).toContainText('1000–999')
  await expect(page.getByRole('dialog')).toContainText('Best of 101')
  await page.keyboard.press('Escape')
  await page.locator('[data-display-id="pandascore-0000000000000427"]').click()
  await expect(page.getByRole('dialog')).toContainText('conflicting phase records')
  await expect(
    page.getByRole('dialog').getByRole('region', { name: 'Published match scoreboard' }),
  ).toContainText('Result unavailable')
})

test('v2 event hierarchy keeps two Playoffs identities separate across links, reload and history', async ({
  page,
}) => {
  await intercept(page, () => 'v2-valid')
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto(
    './?view=live&live_provider=pandascore&live_status=all&research_group=preserve-me',
  )
  await page.getByRole('button', { name: 'Events', exact: true }).click()
  const directory = page.getByRole('region', { name: 'Observed event directory' })
  await directory.getByRole('button', { name: /^Open observed league / }).click()
  await directory.getByRole('button', { name: /^Open observed series / }).click()
  await expect(
    directory.getByRole('heading', { name: 'TEST ONLY Championship 2026 · Fall', exact: true }),
  ).toBeVisible()
  const playoffs = directory.getByRole('button', { name: /^Open observed tournament Playoffs,/ })
  await expect(playoffs).toHaveCount(2)
  await playoffs.first().click()
  await expect(page).toHaveURL(/live_event=pandascore-000000000000138a/)
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(5)
  await expect(page).toHaveURL(/research_group=preserve-me/)
  await page.reload()
  await expect(directory.getByRole('heading', { name: 'Playoffs', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(5)
  await directory
    .getByRole('navigation', { name: 'Observed event breadcrumbs' })
    .getByRole('button', { name: 'TEST ONLY Championship 2026 · Fall', exact: true })
    .click()
  await playoffs.last().click()
  await expect(page).toHaveURL(/live_event=pandascore-000000000000138b/)
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(3)
  await directory.getByRole('button', { name: 'Show matching announcements' }).click()
  await expect(page).toHaveURL(/live_tab=matches/)
  await expect(directory).not.toBeVisible()
  await page.goBack()
  await expect(directory).toBeVisible()
  await expect(page).toHaveURL(/live_event=pandascore-000000000000138b/)
  await noPageOverflow(page)
})

test('confirmed UTC filtering precedes counts and pagination, with unresolved dates included explicitly', async ({
  page,
}) => {
  await intercept(page, () => 'v2-valid')
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto('./?view=live&live_status=all&live_from=2026-10-07&live_to=2026-10-07')
  await expect(page.getByRole('status').filter({ hasText: /^26 matches$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(25)
  await page.getByRole('button', { name: 'Next published matches page' }).click()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(1)
  await page.getByRole('button', { name: 'VALORANT published provider PandaScore' }).click()
  await page.getByRole('button', { name: 'All statuses', exact: true }).click()
  await page.getByText('UTC date filters · active', { exact: true }).click()
  const from = page.getByLabel('Published UTC date from'),
    through = page.getByLabel('Published UTC date through'),
    unresolved = page.getByRole('checkbox', { name: 'Include unresolved dates' })
  await from.fill('2026-10-08')
  await expect(page.getByRole('alert')).toContainText('From must be on or before Through')
  await expect(through).toBeVisible()
  await through.fill('2026-10-08')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(from).toBeVisible()
  await expect(through).toBeVisible()
  await expect(unresolved).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^3 matches$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(3)
  await unresolved.uncheck()
  await expect(unresolved).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^0 matches$/ })).toBeVisible()
  await expect(page).toHaveURL(/live_include_undated=false/)
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: /^0 matches$/ })).toBeVisible()
  await expect(page.locator('.published-date-filters')).not.toHaveAttribute('open')
  await page.getByText('UTC date filters · active', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Include unresolved dates' })).not.toBeChecked()
  await page.getByLabel('Published UTC date from').fill('2026-10-09')
  await expect(page.getByRole('alert')).toContainText('From must be on or before Through')
  await page.goto('./?view=live&live_status=all&live_from=2026-02-30')
  await expect(page.getByRole('alert')).toContainText('real UTC calendar date')
  await expect(page.locator('.published-date-filters')).toHaveAttribute('open')
  await expect(unresolved).toBeVisible()
  await page.goto('./?view=live&live_status=all&live_from=2026-01-01&live_to=2027-01-02')
  await expect(page.getByRole('alert')).toContainText('366 days or less')
  await expect(page.locator('.published-date-filters')).toHaveAttribute('open')
})

test('resealed invalid v2 pairs keep the complete last-good directory and matches', async ({
  page,
}) => {
  let mode = 'v2-valid'
  const manifests = await intercept(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto(
    './?view=live&live_provider=pandascore&live_status=all&live_tab=events&live_event=pandascore-000000000000138a',
  )
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(5)
  for (const invalid of [
    'v2-new-pair-invalid',
    'v2-bad-source-day',
    'v2-bad-parent',
    'v2-duplicate-node',
    'v2-scheduled-score',
    'v2-future',
  ]) {
    mode = invalid
    const before = manifests()
    await page.getByRole('button', { name: 'Refresh current provider' }).click()
    await expect.poll(manifests).toBeGreaterThan(before)
    await expect(page.getByRole('alert')).toContainText('last verified display package')
    await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(5)
    await expect(page.getByRole('heading', { name: 'Playoffs', exact: true })).toBeVisible()
  }
})

test('resealed v2 source-mode contradictions retain the entire verified event scope', async ({
  page,
}) => {
  await retainLastGoodForResealedStates(page, [
    'v2-source-publication-without-calendar',
    'v2-source-calendar-without-publication',
    'v2-source-missing-observed-directory',
    'v2-source-canonical-missing-directory',
    'v2-source-directory-without-calendar',
    'v2-source-reported-football',
    'v2-source-reported-without-calendar',
  ])
})

test('resealed v2 impossible associations and resolutions retain verified cards and nodes', async ({
  page,
}) => {
  await retainLastGoodForResealedStates(page, [
    'v2-association-latest-without-canonical',
    'v2-association-latest-football',
    'v2-association-latest-pending-resolution',
    'v2-association-latest-pending-reasons',
    'v2-association-historical-without-canonical',
    'v2-association-historical-without-calendar',
    'v2-association-legacy-paired',
    'v2-association-legacy-observed-directory',
    'v2-association-legacy-wrong-association',
    'v2-association-legacy-pending',
    'v2-association-validated-pending',
    'v2-association-conflicted-without-reason',
    'v2-association-canonical-paired',
    'v2-association-canonical-pending',
    'v2-association-canonical-without-canonical',
  ])
})

test('paired v2 collection remains usable without status telemetry and ages on its 120-second fallback', async ({
  page,
}) => {
  let mode = 'v2-status-missing'
  await intercept(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto('./?view=live&live_provider=pandascore&live_status=all')
  const health = page.getByRole('region', { name: 'Published source health' })
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(8)
  await expect(health).toContainText('Recent source check')
  await health.getByText('Inspect published collection evidence', { exact: true }).click()
  await expect(health).toContainText('11:59:30 UTC')
  await expect(health).toContainText('Calendar observation cutoff')
  await expect(health).toContainText('11:58:30 UTC')
  await expect(health).toContainText('status_missing')
  await expect(health).toContainText('past · upcoming · running')
  await page.getByRole('button', { name: 'Events', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Open observed league / })).toHaveCount(1)
  for (const invalid of [
    'v2-status-missing-no-publication',
    'v2-status-missing-no-threshold',
    'v2-status-missing-wrong-success',
    'v2-status-missing-ledger-change',
  ]) {
    mode = invalid
    await page.getByRole('button', { name: 'Refresh current provider' }).click()
    await expect(page.getByRole('alert')).toContainText('last verified display package')
    await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(8)
    await expect(page.getByRole('button', { name: /^Open observed league / })).toHaveCount(1)
  }
  mode = 'v2-status-missing'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.clock.fastForward(90000)
  await expect(health).toContainText('Stale source check')
})

test('legacy v1 exposes verified matches and marks event/calendar coverage unavailable', async ({
  page,
}) => {
  await intercept(page)
  await clockAndOpen(page)
  await page.getByRole('button', { name: 'Events', exact: true }).click()
  const directory = page.getByRole('region', { name: 'Observed event directory' })
  await expect(directory).toContainText('Match-only source publication')
  await expect(directory).toContainText('unavailable in this publication')
  await expect(directory.getByRole('button', { name: /^Open observed / })).toHaveCount(0)
  const health = page.getByRole('region', { name: 'Published source health' })
  await health.getByText('Inspect published collection evidence', { exact: true }).click()
  await expect(health).toContainText('Calendar observation cutoff')
  await expect(health).toContainText('Unavailable in this publication')
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(25)
})

test('compact 390px matches and 320px Unicode event metadata have no document overflow', async ({
  page,
}) => {
  let mode = 'v2-valid'
  const requests: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  await intercept(page, () => mode)
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./?view=live&live_provider=pandascore&live_status=all')
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(8)
  await expect(
    page.getByRole('button', { name: /^Inspect published match / }).first(),
  ).toBeInViewport()
  await expect(page.locator('.live-health-evidence')).not.toHaveAttribute('open')
  await expect(page.locator('.published-date-filters')).not.toHaveAttribute('open')
  await noPageOverflow(page)
  mode = 'v2-long-names'
  await page.getByRole('button', { name: 'Refresh current provider' }).click()
  await expect(
    page.getByRole('button', { name: /^Inspect published match / }).first(),
  ).toContainText('競技'.repeat(60))
  await page.setViewportSize({ width: 320, height: 740 })
  await noPageOverflow(page)
  await page.getByRole('button', { name: 'Events', exact: true }).click()
  await page.getByRole('button', { name: /^Open observed league / }).click()
  await page.getByRole('button', { name: /^Open observed series / }).click()
  await noPageOverflow(page)
  expect(
    requests.filter((path) => /\/api\/|\/gold\/|snapshot\.json|open-football\.json/.test(path)),
  ).toEqual([])
})

test('v2 legacy recovery preserves a proved final score with calendar coverage unavailable', async ({
  page,
}) => {
  await intercept(page, () => 'v2-legacy-recovery')
  await page.clock.install({ time: new Date('2026-10-06T12:00:05Z') })
  await page.goto('./?view=live&live_provider=pandascore&live_status=finished&live_tab=events')
  await expect(page.getByRole('region', { name: 'Observed event directory' })).toContainText(
    'unavailable in this publication',
  )
  await expect(page.getByRole('button', { name: /^Inspect published match / })).toHaveCount(1)
  await page.getByRole('button', { name: /^Inspect published match / }).click()
  await expect(
    page.getByRole('dialog').getByRole('region', { name: 'Published match scoreboard' }),
  ).toContainText('Final result')
  await expect(page.getByRole('dialog')).toContainText('2–1')
  await expect(page.getByRole('dialog')).toContainText('calendar resolution unavailable')
})
