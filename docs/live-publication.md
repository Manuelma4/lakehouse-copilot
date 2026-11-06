# Processed current-data display publication

`arena-live-display-1.0` is a small own-site display contract built from verified
private canonical captures. It provides processed match cards and honest source
freshness, not a copy of the canonical tables, a provider database mirror, or a
provider API proxy. This module makes no requests and runs no prediction models.

## Source and use boundary

The exporter takes exactly one immutable `LiveRegistry.capture()` per provider.
That existing importer verifies private canonical bytes and queries the resulting
in-memory data. The display exporter does not reopen mutable match files, select
raw response archives, read credentials, or choose a synthetic fallback.

PandaScore permits informational display on the account owner's website under its
subscription terms, requires processing rather than transferring response data
as-is, and requires the visible attribution **Source: PandaScore**. The static
cards are specifically processed and bounded for that own-site use; they are not
licensed here as a reusable dataset or a public API product. No client receives
direct access to PandaScore's API or private responses. The account owner's
actual use remains subject to the provider's current terms.
[PandaScore terms, articles 6.3–6.4](https://www.pandascore.co/terms-and-condition).

Football-data requires the visible attribution **Football data provided by the
Football-Data.org API** and confidential account credentials. Its account terms
also govern application use and continued display after subscription termination.
Provider-derived display data is separate from the repository's MIT code license.
[Football-data registration terms](https://www.football-data.org/client/register).

The exporter carries the exact provider attribution, website link, terms link,
and provider-data license note in each provider payload. The frontend renders
those credits visibly. Team logos, player identities, rosters, stream
links, in-game rounds, chat transcripts, forecasts, odds, and personal information
are absent. The private 124-record announcement calendar is a different contract;
unresolved announcements are not merged into these strict canonical match cards.

Display files are generated deployment artifacts excluded from Git. The
[local refresh procedure](current-delivery.md) builds them from private runtime
state for a site covered by the provider's terms.

## Processing and coverage

For each provider, the window includes UTC calendar days from the publication day
minus 14 through the publication day plus 30, inclusively, plus all source-reported
running matches. At most 500 cards are displayed. The ordering is deterministic:
running matches by kickoff, source-reported scheduled matches by kickoff, then
other statuses by most recent kickoff. Display identity breaks equal-time ties.
The exporter does not assume a scheduled match has started because its time has
passed.

Coverage reports retained canonical rows, rows eligible for this window, displayed
rows, clipping, rows outside the window, and running rows outside the normal date
range. These numbers describe the retained private store and this display slice,
not complete provider coverage. Unsupported records from the last poll are
labelled separately; a recent check does not mean all retained rows changed.

Each card contains only:

| Field | Meaning |
| --- | --- |
| `display_id` | A derived site identity, never an original provider match ID |
| `sport`, `competition_label` | Sport and reviewed display label |
| `team_a`, `team_b` | Derived display identity and team label |
| `kickoff_utc`, `day_utc`, `kickoff_label` | Verified aware kickoff, derived UTC day, and UTC clock label |
| `status_label` | Scheduled, In progress, Finished, Cancelled, or Postponed |
| `series_format` | Single match for football; source-derived Best of N for VALORANT |
| `score_label`, `result_state`, `winning_side` | Processed result display and conservative confirmation state |

Display identities are `<provider>-<16 hex>` derived from
`sha256(provider + '\0' + entity_kind + '\0' + canonical_identity)[:16]`.
Match and team identities have separate entity kinds. They are stable site keys,
not official identifiers, encryption, or an anonymity guarantee. No original
match/team ID, event ID, revision, raw hash, cursor, or database row is exported.

Scores become display results only for running or finished source statuses and
only after the verified kickoff instant. Finished results are final; running
scores are provisional. Scheduled, canceled, postponed, and future-running rows
have no display score or winning side, even when source columns contain zeros or
other numbers. These are football scores or VALORANT series-map scores, never a
live round count. Missing provisional scores remain unavailable. Nothing derives
new source statuses from the publication clock.

## Wire identity and freshness

A publication contains exactly three regular files:

- `manifest.json`
- `football-data.json`
- `pandascore.json`

The manifest has `schema_version='arena-live-display-1.0'`,
`data_kind='processed_api_display'`, `display_version`, `package_fingerprint`,
`generated_at`, `window_day_utc`, the fixed provider list, provider `facts_versions`,
an exact SHA-256 file inventory, and a processing note.

Each provider payload contains `provider`, `facts_version`, `cards`, `canonical`,
`health`, `coverage`, `attribution`, and `license_note`, plus the same display
contract/data kind. `canonical` is nullable and contains the private source's
`dataset_version`, `snapshot_fingerprint`, `cutoff`, and `generated_at`. These are
provenance references, not the display's identity or a provider data URL.

`health` contains the source state, producer state, original successful and change
clocks, current attempted clock and sanitized error code, staleness and last-good
flags, actual poll cadence and stale threshold, source and attempted poll scopes,
and provider delay capabilities. Unknown scope remains `unknown_poll_scope`.
Football free scores are delayed. VALORANT fixture polling has no claim of
real-time round delivery. A freshly generated manifest never substitutes for a
successful provider check.

Staleness in the artifact describes its publication time. A static frontend must
also compute current age from `last_success_at` and `stale_after_seconds` when
rendering it; a stopped deployment must not keep appearing current. Dataset
cutoff, successful check, and display generation are different clocks.

Identity algorithms use canonical UTF-8 JSON with `sort_keys=True`, separators
`(',', ':')`, `ensure_ascii=False`, and `allow_nan=False`:

- `facts_version = sha256({provider, cards_sorted_by_display_id, coverage_without_unsupported_last_poll_and_note})[:16]`.
- `display_version = sha256({football-data: full_provider_payload, pandascore: full_provider_payload})[:16]`.
- `package_fingerprint = sha256({schema_version, display_version, files})`.

Publication time is excluded from these identities. Unchanged displayed facts and
window preserve the facts version across successful unchanged polls; their check
clock or health can still change the full display version. Window shifts, clipping
selection, statuses, scores, or retained coverage facts can change facts identity.
Identical payloads reused at the same output preserve the original manifest.

## Previous-display recovery

Ephemeral deployment jobs can supply a previously validated **own-site display**
package. It is never used as an ingest cursor, a provider response cache, or a
replacement canonical table. For a failed or unavailable provider, the exporter
retains its current independently verified last-good capture when one is
available. A previous public display replaces it only when the prior source
cutoff and successful check are at least as recent with one source clock later, or when
there is no current verified source. Equal or conflicting source-clock orderings
keep the verified current capture; a newer display build time proves nothing about
source freshness. When both successful check clocks are unknown, only a later
source cutoff establishes newer prior facts.
If the current successful check is unknown, a prior known check with an equally
recent or newer cutoff is preferred without inventing the missing current clock.

Selected previous facts retain their processed cards, canonical provenance, facts
version, and original coverage window. The exporter preserves those successful/change clocks,
sets `serving_last_good=true` and `stale=true`, and exposes the current failed
attempt/error when available. A missing status file leaves the attempted provider
check unknown; the display build does not invent a network call.

`health.source_scope` describes the last successfully displayed facts;
`health.attempt_scope` describes the current attempt. Each coverage object retains
its own `window_day_utc`, which may be older than the new manifest's build day
only for explicitly stale last-good recovery. Provider recovery is independent:
one failure does not prevent fresh cards for the other provider.

The parent deployment may download exactly these three files from its fixed own
Pages origin using bounded requests. This module accepts only a local package
path, verifies the exact inventory, all checksums, logical identities and typed
semantics, and performs no download. Invalid previous assets fail the build; they
are not silently accepted as a fallback.

## API and commands

```python
from arena_copilot.live_publication import export_live_display, validate_live_display

manifest = export_live_display(
    registry,
    new_artifact_directory,
    limit=500,
    previous=previous_own_site_package_or_none,
)
validated = validate_live_display(new_artifact_directory)
```

An optional aware `now` argument supplies a deterministic clock. Without it, the
publication clock is obtained after both captures. Every captured/source clock
must be no later than publication. `validate_live_display(path, now=...)` returns
the verified manifest and provider payloads without loading private source files.

```powershell
$env:PYTHONPATH='C:\Works\.arena-worktrees\research-groups\src'
python scripts/export_live_display.py --workspace PRIVATE_ROOT --output NEW_BUILD_DIRECTORY
python scripts/export_live_display.py --workspace PRIVATE_ROOT --output NEW_BUILD_DIRECTORY --previous-package PREVIOUS_DISPLAY_DIRECTORY
```

The CLI accepts `--limit 1..500` and an optional aware ISO `--clock`. No credentials
are accepted by the CLI. Missing sources still yield explicit unavailable states
and mandatory attribution; they never switch to the bundled demo.

The output is atomically created in a fresh destination. Existing identical
packages are validated and reused; different existing content is rejected rather
than partly overwritten. The parent deployer creates a fresh artifact directory
and publishes it separately. Each provider JSON is limited to 2 MiB, the manifest
to 64 KiB, and the artifact to these three files. Unexpected files, directories,
links, Windows reparse points, unsafe paths, duplicate JSON keys, non-finite
numbers, malformed/future clocks, cross-provider data, and inconsistent derived
dates/results/coverage/versions are rejected.

## Verification and deployment scope

Tests use original simulated API-labelled fixtures only. They cover one capture
per provider, window boundaries and cap, nullable/unconfirmed results, source
freshness, independent last-good recovery, exact inventory, processed-field
privacy, tampering, semantic resealing, version coherence, and the offline CLI.
Actual-source display verification and frontend/deployment integration are
separate gates.

A fresh hosted workspace reconstructs a bounded current source view. Without
durable ingestion state it cannot claim historical CDC, preserved first-seen
availability, or point-in-time backtests. The display's original cutoff always
reflects its actual canonical input. A deployment also needs one polling owner
per account: repository concurrency cannot lock an independently running local
worker or a second repository. This module neither starts a poller nor changes
the private worker, public frontend, workflow, or account configuration.
