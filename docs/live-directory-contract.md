# Processed current directory contract

Status: implementation contract for the next release. The public v0.6 site still
uses `arena-live-display-1.0`; this document does not claim a v2 deployment.

The next publishing workflow emits `arena-live-display-2.0` in the same exact
three-file inventory: `manifest.json`, `football-data.json`, `pandascore.json`.
Manifest and provider bodies retain their v1 identities, checksums, attribution,
health, canonical provenance and bounded publication rules. The manifest's schema
version participates in its fingerprint. Readers explicitly validate either
version; adapting a validated v1 body in memory does not rewrite its fingerprints.

## Provider body additions

- `calendar`: null, or `{dataset_version, calendar_fingerprint, facts_version,
  cutoff, generated_at}`. Versions are 16 lowercase hex; fingerprints are 64 hex;
  clocks are normalized aware UTC. This is calendar observation evidence.
- `publication`: null, or `{fingerprint, collected_at, selected_at}`. These are
  completed collection and selector observations, distinct from canonical cutoff.
- `directory_status`: `observed` or `not_supplied`.
- `directory_nodes`: at most 1,500 processed nodes referenced by displayed cards
  or their ancestors. This is observed bounded coverage, not an event inventory.

Each node has `display_id`, `kind` (`competition`, `league`, `series`,
`tournament`), `parent_id` (nullable), `label`, nullable `name`, `full_name`,
`season`, `year`, `identity_basis` (`source_identity`, `observed_label`,
`unresolved_metadata`), `metadata_conflicted`, and `parent_conflicted`.
Labels and season are at most 120 clean characters; names/full names are at most
240, and years range from 1900 to 2200. Missing labels use an explicitly
unsupplied descriptive label. Provider identities are hashed, never published.
Distinct source identities named Playoffs stay distinct. Conflicting parents
produce null parent references and a flag; hierarchy is never guessed.

Football exposes observed competition labels only, without invented season or
event hierarchy. VALORANT uses supplied league, series and tournament identities.
Name-only VALORANT metadata is isolated by announcement and marked unresolved.

## Cards

Cards retain v1 fields; `team_a`, `team_b`, `kickoff_utc`, `day_utc`,
`kickoff_label`, and `series_format` become nullable. Unknown opponents are null;
the browser renders “Opponent pending”, without constructing a fictitious team.
Additional fields:

- `event_node_ids`: ordered league/series/tournament or competition references.
- `announcement_label`: nullable clean supplied match name.
- `kickoff_precision`: `utc`, `source_date`, `timezone_unknown`, `unknown`.
- `kickoff_source_text`: nullable validated source date/time text.
- `resolution`: `validated`, `pending`, `conflicted`, `legacy`.
- `pending_reasons`: unique sorted values from the private calendar's fixed enum.
- `association_state`: `none`, `canonical_record`, `associated_historical`,
  `matches_latest_announcement`.

`status_label` also accepts `Unknown`. `result_state` also accepts
`source_reported`. Only an associated canonical record agreeing with the current
announcement's teams, kickoff, status, format and scores can supply a validated
final result. Otherwise suitable latest source scores are labelled source
reported; unknown opponents, conflicts, scheduled scores and future kickoffs
remain unavailable. Historical association never fills missing current fields.
A match's opaque display ID is stable when pending details resolve. V2 source
formats allow Best of 1 through 101, and source-reported scores allow 0 through
1,000. Validated final/provisional scores retain the canonical maximum of 50.
Canonical-only football records and explicitly marked legacy match projections
use `canonical_record`; they can retain previously validated final results
without claiming an unavailable announcement comparison.

## Coverage and filtering

Coverage retains v1 fields and adds `unknown_utc_total`, `eligible_total`,
`eligible_undated_total`, `pending_total`, `pending_displayed`, and
`directory_nodes_displayed`. `retained_total = window_total + outside_window +
unknown_utc_total`; `eligible_total = window_total + unknown_utc_total`;
`displayed + clipped = eligible_total`. Running records outside the date window
are included in `window_total` and counted separately, as in v1.

The initial known UTC window is publication day minus 14 through plus 30 days.
Announcements with unresolved UTC dates remain eligible, bounded by the same
500-card cap. UI date ranges compare confirmed `day_utc` only. An explicit
“Include unresolved dates” option defaults to true; date-only/unzoned source
text is never compared as UTC or assigned a UTC date. Filters precede counting
and pagination, persist in the URL, and retain the existing match-detail links.

Facts versions cover cards, directory nodes/status, and coverage business counts;
they exclude collection/build clocks, unsupported-poll diagnostics and notes.
Last-good recovery retains both verified members and their original source
clocks/window. New build times cannot refresh old evidence. Legacy v1 recovery
can provide verified matches only, with calendar and directory unavailable.

## Local transport

`GET /api/live/display` returns exact `manifest_json` and two `provider_json`
strings, a UTC `captured_at`, and private `canonical_links` maps keyed by provider
and opaque card ID. Each map value has `match_id` and `snapshot_fingerprint`.
There are at most 500 links per provider; the envelope is bounded by 9 MiB. Body
checksums and all display validators are shared with the static transport.

Projection and links come from the same single capture per provider. A link is
present only for a currently agreeing validated announcement or a canonical-only
record. Pending, conflicted or disagreeing historical associations do not enable
model context. The frontend checks the linked canonical fingerprint against the
fetched strict record before offering its retained record tools and chat. Changed
versions require a refresh. The static website never receives these private maps
or accesses this endpoint.

Local chat carries the selected strict record's optional `snapshot_fingerprint`.
The server compares it against its single capture before opening tool queries,
request checkpoints or a model call. A mismatch returns HTTP 409 and requires a
record refresh. Requests already holding an accepted immutable capture can finish
against that version while later board requests see a successor.

A paired publication supplies the successful collection clock and scope even
when status telemetry is missing. Missing cadence remains null; that case uses
an explicit conservative 120-second staleness threshold. Paired change clocks
remain null because a later ledger completion does not establish when displayed
business facts changed.

All public bodies remain bounded by 2 MiB and the manifest by 64 KiB. No original
provider IDs, archive inventories, raw responses, logos, credentials, model
traces, odds, round telemetry or downloadable canonical database are published.
