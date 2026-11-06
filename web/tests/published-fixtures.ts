import { createHash } from 'node:crypto'

// Original TEST ONLY processed-card contract fixture. No API responses, private
// canonical files, actual publications or public assets are modified by these tests.
const canonical = (value: any): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value)
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
export const opaqueMatchID = (provider: string, matchID: string) =>
  `${provider}-${hash(`${provider}\0match\0${matchID}`).slice(0, 16)}`
const schema = 'arena-live-display-1.0',
  source = '2026-10-06T11:59:30.000000Z',
  publication = '2026-10-06T12:00:00.000000Z'
function providerData(provider: string) {
  const panda = provider === 'pandascore'
  const id = (n: number) => `${provider}-${n.toString(16).padStart(16, '0')}`
  const card = (index: number, status = 'Scheduled') => ({
    display_id: id(1000 + index),
    sport: panda ? 'valorant' : 'football',
    competition_label: 'TEST ONLY Display Competition',
    team_a: { display_id: id(index + 10), label: `TEST ONLY Águila ${index + 1}` },
    team_b: { display_id: id(index + 100), label: `TEST ONLY City ${index + 1}` },
    kickoff_utc:
      status === 'Scheduled'
        ? `2026-10-07T${String(10 + Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}:00.000000Z`
        : '2026-10-06T11:00:00.000000Z',
    day_utc: status === 'Scheduled' ? '2026-10-07' : '2026-10-06',
    kickoff_label:
      status === 'Scheduled'
        ? `${String(10 + Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')} UTC`
        : '11:00 UTC',
    status_label: status,
    series_format: panda ? 'Best of 3' : 'Single match',
    score_label: status === 'Scheduled' ? null : status === 'Finished' ? '2–1' : '0–0',
    result_state:
      status === 'Scheduled' ? 'unavailable' : status === 'Finished' ? 'final' : 'provisional',
    winning_side: status === 'Finished' ? 'team_a' : null,
  })
  const cards = [
    card(50, 'In progress'),
    ...Array.from({ length: panda ? 1 : 26 }, (_, index) => card(index)),
    card(51, 'Finished'),
  ]
  return {
    schema_version: schema,
    data_kind: 'processed_api_display',
    provider,
    facts_version: '',
    canonical: {
      dataset_version: 'ab'.repeat(8),
      snapshot_fingerprint: 'cd'.repeat(32),
      cutoff: '2026-10-06T11:58:00.000000Z',
      generated_at: '2026-10-06T11:59:00.000000Z',
    },
    health: {
      state: 'ready',
      producer_state: 'ready',
      stale: false,
      serving_last_good: false,
      last_attempt_at: source,
      last_success_at: source,
      last_change_at: '2026-10-06T11:58:00.000000Z',
      poll_interval_seconds: 60,
      stale_after_seconds: 120,
      source_scope: panda
        ? {
            kind: 'match_phases',
            competition_codes: [],
            phases: ['past', 'upcoming', 'running'],
            pages: 1,
          }
        : { kind: 'competition_list', competition_codes: ['PL'], phases: [], pages: 1 },
      attempt_scope: null,
      freshness_scope: 'declared_poll_scope',
      error_code: null,
      scores_delayed: panda ? null : true,
      update_mode: 'polled_rest',
      in_game_round_feed: false,
    },
    coverage: {
      retained_total: 300,
      window_total: cards.length,
      displayed: cards.length,
      clipped: 0,
      outside_window: 300 - cards.length,
      running_outside_window: 0,
      unsupported_last_poll: 0,
      card_limit: 500,
      window_from: '2026-09-22',
      window_through: '2026-11-05',
      window_day_utc: '2026-10-06',
      note: 'TEST ONLY retained display scope, not complete provider coverage.',
    },
    attribution: panda
      ? {
          text: 'Source: PandaScore',
          url: 'https://www.pandascore.co/',
          terms_url: 'https://www.pandascore.co/terms-and-condition',
        }
      : {
          text: 'Football data provided by the Football-Data.org API',
          url: 'https://www.football-data.org/',
          terms_url: 'https://www.football-data.org/client/register',
        },
    license_note:
      "Provider-derived processed cards for the account owner's informational website; not MIT, CC0, or a reusable provider data feed.",
    cards,
  }
}
function directoryData(provider: string, resolved = false): any {
  const data: any = providerData(provider),
    panda = provider === 'pandascore',
    id = (n: number) => `${provider}-${n.toString(16).padStart(16, '0')}`,
    node = (n: number, kind: string, parent: number | null, name: string, extra = {}) => ({
      display_id: id(n),
      kind,
      parent_id: parent === null ? null : id(parent),
      label: name,
      name,
      full_name: null,
      season: null,
      year: null,
      identity_basis: 'source_identity',
      metadata_conflicted: false,
      parent_conflicted: false,
      ...extra,
    })
  data.schema_version = 'arena-live-display-2.0'
  data.calendar = panda
    ? {
        dataset_version: 'ef'.repeat(8),
        calendar_fingerprint: '12'.repeat(32),
        facts_version: '34'.repeat(8),
        cutoff: '2026-10-06T11:58:30.000000Z',
        generated_at: '2026-10-06T11:59:00.000000Z',
      }
    : null
  data.publication = { fingerprint: '56'.repeat(32), collected_at: source, selected_at: source }
  data.health.last_change_at = null
  data.directory_status = 'observed'
  data.directory_nodes = panda
    ? [
        node(5000, 'league', null, 'TEST ONLY International League'),
        node(5001, 'series', 5000, 'Championship', {
          full_name: 'TEST ONLY Championship 2026',
          season: 'Fall',
          year: 2026,
        }),
        node(5002, 'tournament', 5001, 'Playoffs'),
        node(5003, 'tournament', 5001, 'Playoffs'),
      ]
    : [
        node(5000, 'competition', null, 'TEST ONLY Display Competition', {
          identity_basis: 'observed_label',
        }),
      ]
  data.cards = data.cards.map((card: any) => ({
    ...card,
    event_node_ids: panda
      ? [id(5000), id(5001), id(card.status_label === 'Finished' ? 5003 : 5002)]
      : [id(5000)],
    announcement_label: null,
    kickoff_precision: 'utc',
    kickoff_source_text: null,
    resolution: 'validated',
    pending_reasons: [],
    association_state: panda ? 'matches_latest_announcement' : 'canonical_record',
  }))
  if (panda) {
    const scheduled = data.cards[1],
      pending = {
        ...scheduled,
        display_id: id(1060),
        team_b: null,
        kickoff_utc: null,
        day_utc: null,
        kickoff_label: null,
        series_format: null,
        kickoff_precision: 'source_date',
        kickoff_source_text: '2026-10-08',
        announcement_label: 'TEST ONLY Pending announcement',
        resolution: 'pending',
        pending_reasons: ['unresolved_opponents', 'unresolved_start_time'],
        association_state: 'none',
      },
      unzoned = {
        ...pending,
        display_id: id(1061),
        kickoff_precision: 'timezone_unknown',
        kickoff_source_text: '2026-10-08T23:30:00',
        announcement_label: 'TEST ONLY Unzoned announcement',
        pending_reasons: [
          'start_time_timezone_unknown',
          'unresolved_opponents',
          'unresolved_start_time',
        ],
      },
      unknown = {
        ...pending,
        display_id: id(1062),
        team_a: null,
        kickoff_precision: 'unknown',
        kickoff_source_text: null,
        status_label: 'Unknown',
        announcement_label: 'TEST ONLY Unknown announcement',
        pending_reasons: ['unknown_status', 'unresolved_opponents', 'unresolved_start_time'],
      },
      conflict = {
        ...data.cards.at(-1),
        display_id: id(1063),
        score_label: null,
        winning_side: null,
        result_state: 'unavailable',
        resolution: 'conflicted',
        pending_reasons: ['conflicting_phase_records'],
        association_state: 'associated_historical',
        announcement_label: 'TEST ONLY Conflicting announcement',
      },
      reported = {
        ...data.cards.at(-1),
        display_id: id(1064),
        score_label: '1000–999',
        winning_side: null,
        result_state: 'source_reported',
        association_state: 'associated_historical',
        announcement_label: 'TEST ONLY Latest source score',
        series_format: 'Best of 101',
        event_node_ids: [id(5003)],
      }
    if (resolved)
      Object.assign(pending, {
        team_b: scheduled.team_b,
        kickoff_utc: '2026-10-08T12:00:00.000000Z',
        day_utc: '2026-10-08',
        kickoff_label: '12:00 UTC',
        kickoff_precision: 'utc',
        kickoff_source_text: '2026-10-08T12:00:00Z',
        series_format: 'Best of 3',
        resolution: 'validated',
        pending_reasons: [],
      })
    data.cards = [
      ...data.cards.slice(0, -1),
      ...(resolved ? [pending] : []),
      ...(resolved ? [] : [pending]),
      unzoned,
      unknown,
      ...[data.cards.at(-1), conflict, reported].sort((a, b) =>
        a.display_id.localeCompare(b.display_id),
      ),
    ]
  }
  const undated = data.cards.filter((card: any) => !card.day_utc).length,
    pending = data.cards.filter((card: any) => card.pending_reasons.length).length
  Object.assign(data.coverage, {
    displayed: data.cards.length,
    eligible_total: data.cards.length,
    window_total: data.cards.length - undated,
    unknown_utc_total: undated,
    eligible_undated_total: undated,
    pending_total: pending,
    pending_displayed: pending,
    directory_nodes_displayed: data.directory_nodes.length,
    outside_window: 300 - data.cards.length,
  })
  return data
}
export function packageFixture(kind = 'valid') {
  const v2 = kind.startsWith('v2-')
  const values: Record<string, any> = {
    'football-data': v2 ? directoryData('football-data') : providerData('football-data'),
    pandascore: v2
      ? directoryData('pandascore', kind === 'v2-resolved')
      : providerData('pandascore'),
  }
  if (
    kind === 'v2-legacy-recovery' ||
    ['v2-association-legacy-wrong-association', 'v2-association-legacy-pending'].includes(kind)
  ) {
    for (const provider of ['football-data', 'pandascore']) {
      const legacy: any = providerData(provider)
      Object.assign(legacy, {
        schema_version: 'arena-live-display-2.0',
        calendar: null,
        publication: null,
        directory_status: 'not_supplied',
        directory_nodes: [],
        cards: legacy.cards.map((card: any) => ({
          ...card,
          event_node_ids: [],
          announcement_label: null,
          kickoff_precision: 'utc',
          kickoff_source_text: null,
          resolution: 'legacy',
          pending_reasons: [],
          association_state: 'canonical_record',
        })),
      })
      Object.assign(legacy.coverage, {
        eligible_total: legacy.coverage.window_total,
        unknown_utc_total: 0,
        eligible_undated_total: 0,
        pending_total: 0,
        pending_displayed: 0,
        directory_nodes_displayed: 0,
      })
      values[provider] = legacy
    }
  }
  if (['v2-local', 'v2-local-nonnumeric'].includes(kind)) {
    values.pandascore.cards[0].display_id = opaqueMatchID(
      'pandascore',
      kind === 'v2-local' ? 'pandascore:102' : 'pandascore:fixture-1',
    )
    values.pandascore.cards[1].display_id = opaqueMatchID(
      'pandascore',
      kind === 'v2-local' ? 'pandascore:101' : 'pandascore:fixture-0',
    )
  }
  // Every invalid variant is resealed below. These changes isolate source and
  // association semantics rather than relying on a checksum or count mismatch.
  const clearResults = (value: any) => {
      for (const card of value.cards)
        Object.assign(card, { score_label: null, result_state: 'unavailable', winning_side: null })
    },
    omitDirectory = (value: any) => {
      value.directory_status = 'not_supplied'
      value.directory_nodes = []
      value.coverage.directory_nodes_displayed = 0
      for (const card of value.cards) card.event_node_ids = []
    },
    canonicalPanda = () => {
      values.pandascore.calendar = null
      values.pandascore.publication = null
      omitDirectory(values.pandascore)
      clearResults(values.pandascore)
      for (const card of values.pandascore.cards) card.association_state = 'none'
    },
    missingCanonical = () => {
      values.pandascore.canonical = null
      clearResults(values.pandascore)
      for (const card of values.pandascore.cards) card.association_state = 'none'
    }
  if (kind === 'v2-source-publication-without-calendar') {
    const pub = values.pandascore.publication
    canonicalPanda()
    values.pandascore.publication = pub
  }
  if (kind === 'v2-source-calendar-without-publication') values.pandascore.publication = null
  if (kind === 'v2-source-missing-observed-directory') omitDirectory(values.pandascore)
  if (kind === 'v2-source-canonical-missing-directory') omitDirectory(values['football-data'])
  if (kind === 'v2-source-directory-without-calendar') {
    canonicalPanda()
    values.pandascore.directory_status = 'observed'
  }
  if (kind === 'v2-source-reported-football')
    values['football-data'].cards[0].result_state = 'source_reported'
  if (kind === 'v2-source-reported-without-calendar') {
    canonicalPanda()
    Object.assign(values.pandascore.cards.at(-1), {
      score_label: '1000–999',
      result_state: 'source_reported',
    })
  }
  if (kind === 'v2-association-latest-without-canonical') {
    missingCanonical()
    values.pandascore.cards[1].association_state = 'matches_latest_announcement'
  }
  if (kind === 'v2-association-latest-football')
    values['football-data'].cards[1].association_state = 'matches_latest_announcement'
  if (kind === 'v2-association-latest-pending-resolution')
    values.pandascore.cards[1].resolution = 'pending'
  if (kind === 'v2-association-latest-pending-reasons')
    values.pandascore.cards[1].pending_reasons = ['result_unavailable']
  if (kind === 'v2-association-historical-without-canonical') {
    missingCanonical()
    values.pandascore.cards[1].association_state = 'associated_historical'
  }
  if (kind === 'v2-association-historical-without-calendar') {
    canonicalPanda()
    values.pandascore.cards[1].association_state = 'associated_historical'
  }
  if (kind === 'v2-association-legacy-paired')
    Object.assign(values.pandascore.cards[1], {
      resolution: 'legacy',
      association_state: 'canonical_record',
    })
  if (kind === 'v2-association-legacy-observed-directory') {
    values['football-data'].publication = null
    values['football-data'].cards[1].resolution = 'legacy'
  }
  if (kind === 'v2-association-legacy-wrong-association')
    values.pandascore.cards[1].association_state = 'none'
  if (kind === 'v2-association-legacy-pending')
    values.pandascore.cards[1].pending_reasons = ['result_unavailable']
  if (kind === 'v2-association-validated-pending')
    Object.assign(values.pandascore.cards[1], {
      association_state: 'none',
      pending_reasons: ['result_unavailable'],
    })
  if (kind === 'v2-association-conflicted-without-reason')
    values.pandascore.cards.find((card: any) => card.resolution === 'conflicted').pending_reasons =
      []
  if (kind === 'v2-association-canonical-paired')
    values.pandascore.cards[1].association_state = 'canonical_record'
  if (kind === 'v2-association-canonical-pending')
    values['football-data'].cards[1].resolution = 'pending'
  if (kind === 'v2-association-canonical-without-canonical') {
    missingCanonical()
    values.pandascore.cards[1].association_state = 'canonical_record'
  }
  if (kind.startsWith('v2-association-'))
    for (const value of Object.values(values)) {
      const pending = value.cards.filter((card: any) => card.pending_reasons.length > 0).length
      value.coverage.pending_total = value.coverage.pending_displayed = pending
    }
  if (kind.startsWith('v2-status-missing')) {
    Object.assign(values.pandascore.health, {
      producer_state: null,
      last_attempt_at: null,
      last_change_at: null,
      last_success_at: values.pandascore.publication.collected_at,
      poll_interval_seconds: null,
      stale_after_seconds: 120,
      error_code: 'status_missing',
    })
    if (kind === 'v2-status-missing-no-publication') values.pandascore.publication = null
    if (kind === 'v2-status-missing-no-threshold')
      values.pandascore.health.stale_after_seconds = null
    if (kind === 'v2-status-missing-wrong-success')
      values.pandascore.health.last_success_at = '2026-10-06T11:59:31.000000Z'
    if (kind === 'v2-status-missing-ledger-change') values.pandascore.health.last_change_at = source
  }
  if (kind === 'v2-long-names') {
    for (const value of Object.values(values)) value.cards[0].team_a.label = '競技'.repeat(60)
    values.pandascore.directory_nodes[1].full_name = '競技'.repeat(120)
  }
  if (kind === 'v2-new-pair-invalid') values.pandascore.cards[0].team_b = null
  if (kind === 'v2-bad-source-day') values.pandascore.cards[2].day_utc = '2026-10-08'
  if (kind === 'v2-bad-parent')
    values.pandascore.directory_nodes[0].parent_id = values.pandascore.directory_nodes[3].display_id
  if (kind === 'v2-duplicate-node')
    values.pandascore.directory_nodes[3].display_id =
      values.pandascore.directory_nodes[2].display_id
  if (kind === 'v2-scheduled-score')
    Object.assign(values.pandascore.cards[1], {
      score_label: '0–0',
      result_state: 'source_reported',
      winning_side: null,
    })
  if (kind === 'typed-invalid') values.pandascore.cards[0].series_format = ['Best of 3']
  if (kind === 'provider-mismatch') values.pandascore.provider = 'football-data'
  if (kind === 'scheduled-score')
    Object.assign(values.pandascore.cards[1], {
      score_label: '0–0',
      result_state: 'final',
      winning_side: 'draw',
    })
  const generated =
    kind === 'v2-future'
      ? '2026-10-06T12:10:00.000000Z'
      : kind === 'rebuilt-stale'
        ? '2026-10-06T12:02:00.000000Z'
        : ['tampered', 'race'].includes(kind)
          ? '2026-10-06T12:00:01.000000Z'
          : publication
  if (kind === 'rebuilt-stale')
    for (const value of Object.values(values))
      Object.assign(value.health, { state: 'stale', stale: true })
  const bodies: Record<string, string> = {},
    files: Record<string, string> = {},
    facts: Record<string, string> = {}
  for (const [provider, value] of Object.entries(values)) {
    const { unsupported_last_poll: _unsupported, note: _note, ...coverage } = value.coverage
    value.facts_version = hash(
      canonical({
        provider: value.provider,
        cards: [...value.cards].sort((a, b) => (a.display_id < b.display_id ? -1 : 1)),
        ...(v2
          ? {
              directory_nodes: [...value.directory_nodes].sort((a, b) =>
                a.display_id < b.display_id ? -1 : 1,
              ),
              directory_status: value.directory_status,
            }
          : {}),
        coverage,
      }),
    ).slice(0, 16)
    facts[provider] = value.facts_version
    bodies[`${provider}.json`] = `${canonical(value)}\n`
    files[`${provider}.json`] = hash(bodies[`${provider}.json`])
  }
  const version = hash(canonical(values)).slice(0, 16)
  const manifest = {
    schema_version: v2 ? 'arena-live-display-2.0' : schema,
    data_kind: 'processed_api_display',
    display_version: version,
    package_fingerprint: hash(
      canonical({
        schema_version: v2 ? 'arena-live-display-2.0' : schema,
        display_version: version,
        files,
      }),
    ),
    generated_at: generated,
    window_day_utc: '2026-10-06',
    providers: ['football-data', 'pandascore'],
    facts_versions: facts,
    files,
    processing_note: 'TEST ONLY processed display package.',
  }
  bodies['manifest.json'] = `${canonical(manifest)}\n`
  return { bodies, manifest, values }
}
