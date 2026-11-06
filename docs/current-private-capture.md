# Private paired current capture

`LiveRegistry.capture(provider)` reads the bounded
`<root>/<provider>/snapshots/CURRENT_PUBLICATION.json` once. This
`arena-provider-publication-1.0` selector chooses both the canonical package in
`snapshots/` and the PandaScore calendar package in sibling `calendars/`.
`LATEST`, `CALENDAR_LATEST`, and `LIVE_STATUS.latest_snapshot` do not choose pair
members. An absent selector permits the legacy status-only importer. Once a
selector has been observed, malformed or subsequently missing selector data
cannot downgrade that registry entry to legacy selection.

The selector contains a durable `poll_id`, completed collection time
`collected_at`, pre-swap selection time `selected_at`, source scope, nullable
canonical/calendar descriptors, and a SHA-256 `fingerprint`. Each descriptor
contains the approved basename, 16-hex dataset version, and exact manifest-byte
hash. Fingerprint verification uses sorted compact UTF-8 JSON of the original
decoded selector fields except `fingerprint`, before timestamp normalization.
Duplicate JSON keys, nonfinite numbers, wrong types, future clocks, regressions,
and traversal or linked paths are rejected.

The returned frozen `Capture` adds these fields to the established canonical
contract:

| Field | Value |
| --- | --- |
| `calendar` | Immutable `CalendarDataset` or `None` |
| `publication` | Frozen typed `CurrentPublication` or `None` |
| `selection_mode` | `paired` or `legacy` |
| `status_alignment` | `same_collection`, `newer_attempt`, `different_collection`, or `unavailable` |

`CalendarDataset` contains deeply frozen manifest metadata, typed frozen
`announcements`, `occurrences`, and `sources` tuples, a typed `quality` summary,
a read-only announcement `by_id`, `calendar_fingerprint`, and `facts_version`.
The facts version hashes announcement business fields and canonical identity
links without collection observation clocks. Distinct provider event IDs remain
distinct even when their names are identical.

The consumer independently validates every bounded calendar file, manifest and
payload hash, inventory, source page/phase coverage, occurrence linkage,
aggregation rule, pending reason, result derivation, count, and logical version.
Streaming content signatures also detect changed bytes with preserved size and
modification time. Validation does not establish provider authenticity. No
producer imports, archive discovery, credential reads, provider calls, model
calls, or invented missing fields occur at this boundary.

Both members are validated before installing one pair. If either candidate
fails, the registry retains the previous verified pair and marks capture
invalid/stale. A request holding an older capture retains its original immutable
members. A nullable calendar `canonical_match_id` verifies identity existence in
the selected canonical member; current announcement fields can differ from a
retained historical canonical record. PandaScore successful collections always
include a calendar, including empty or entirely unresolved collections. Calendar
availability can therefore be true while canonical snapshot availability is
false; canonical match queries retain their strict existing behavior.

Successful freshness and coverage use `publication.collected_at` and
`publication.source_scope`. `LIVE_STATUS` supplies separate attempt, error, quota,
and operational status telemetry. Its successful ledger completion can follow
selector selection for the same poll; clock equality or a later success clock
alone cannot establish collection identity. Old status without a durable poll ID
defaults to `unavailable`. An attempt after `selected_at` proves a later attempt;
a successful status completed after that later attempt identifies a different
collection, otherwise it identifies `newer_attempt`. A proven scope or selected
canonical basename mismatch also identifies `different_collection`. Optional
typed status `poll_id` can prove `same_collection` with matching scope and
compatible clocks. Missing attempt telemetry does not invalidate a verified
fresh pair.

Health includes publication fingerprint, poll identity and collection/selection
clocks, calendar version/fingerprint/facts version, calendar observation cutoff,
and status alignment. `calendar_observation_cutoff` is the calendar manifest's
`as_of`; the established canonical `cutoff` remains the accepted canonical row
cutoff. In legacy mode `calendar_unavailable_reason` is `legacy_status_only`.
