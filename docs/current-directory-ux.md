# Current event directory and announcement UX

Status: next-release frontend implementation. The public v0.6 site remains the deployment baseline; this document describes the independently validated v2 reader and its rendering contract, not a claim of deployment. Exact publication fields and business invariants are in `live-directory-contract.md`.

## Product structure

Keep **Current matches** as one independent workspace, with compact **Matches** and **Events** tabs and the existing Football / VALORANT provider selector. Matches remains the default. Events is a directory of entities observed in the accepted publication, not an exhaustive competition calendar.

VALORANT follows source-provided **league → series → tournament** relationships. A league row opens its observed series; a series opens its observed tournaments; a tournament opens its announcements. Football uses its supplied competition identity and name, without inventing a series or tournament layer. Each detail has short clickable parent breadcrumbs, a source title, supplied season/year, coverage counts and its match list. Do not concatenate a year twice when it is already part of a supplied full name.

Display a supplied full name where available and preserve the original name in source details. If a title is absent, use explicit UI copy such as **Unnamed source tournament** with a short opaque identity for distinction. Missing parents belong in an **Unassigned source event** bucket; that bucket is a UI category, not a fabricated source entity. Two different tournament IDs called “Playoffs” remain two entries. Relationships and selection use stable provider/role-scoped opaque IDs, never names, team pairings or dates.

Directory rows show title, parent context, supplied season/year, displayed announcement count, pending count and known date range. Counts state their displayed/retained scope and clipping. A date range is the range of known source dates, not a confirmed event schedule. Missing event dates remain **Dates unavailable**. No official standings, brackets, participant rosters, prize pools, odds, logos or forecasts are inferred.

## Match cards and source precision

| Accepted source evidence | Match presentation |
| --- | --- |
| Two supplied resolved teams | Both source names; source-derived display identities in details |
| One or both unresolved rivals | **Opponent pending**; known rival stays visible, no fictitious team identity or monogram |
| Aware exact kickoff | Validated UTC day and clock; retain supplied clock in details |
| Source calendar date only | Source date and **Time unavailable**; no midnight UTC |
| Local clock without an offset | Supplied date/clock and **Timezone unconfirmed**; no UTC conversion |
| No usable date | Separate **Date unconfirmed** group; no artificial ordering time |
| Supplied series format absent | **Series format unavailable**, without guessing BO3 |
| Pending or conflicting source record | Visible reason badge and source status; no played-result claim |

Preserve supplied statuses. A passed kickoff does not turn Scheduled into Running or Finished. An unknown status remains **Unknown**. Display a score only with the accepted publication's explicit result state; upcoming zero fields, unresolved rivals, future kickoff and conflicting variants remain unavailable. Running canonical scores remain provisional. Suitable latest source scores show **Source-reported score**, distinct from **Final result**. Source observations and event dates do not establish historical pre-match availability.

Use one source announcement identity per displayed announcement. Linkage to a canonical match must be explicitly supplied by the publisher. The UI must not join or deduplicate independent records by names or kickoff, expose private IDs, or create a canonical AI context from a processed display key. Existing local match-scoped questions remain available only for validated canonical contexts; public cards do not acquire a hosted model.

## Filters and URL state

The additive query fields are `live_tab`, `live_event`, `live_from`, `live_to` and `live_include_undated`, alongside existing provider/status/search/page/match fields. The event level comes from the verified node kind rather than an independent URL value. Preserve unrelated synthetic and CC0 parameters. Event and provider changes clear incompatible selected matches and reset pagination; ordinary filter changes preserve the selected event. Closing a drawer restores its filtered list; reload, Back and Forward restore the same scope.

The local processed board shares the same reader and components through a bounded `/api/live/display` envelope containing exact serialized files. The envelope's optional canonical link maps never exist in static transport. **Inspect validated record** opens the existing local strict-record drawer/chat only for a validated association, carries the expected canonical fingerprint in `live_canonical_fingerprint`, and rejects a changed fingerprint before showing a match or AI controls. `live_workspace=canonical` preserves direct local canonical links and the explicit **Validated record tools** workspace; ordinary local visits use the processed announcements directory. Pending cards expose no canonical action or AI context. Static profiles ignore canonical workspace values and do not call the local endpoint.

Date inputs use inclusive `YYYY-MM-DD` From / Through values, validate real calendar days, reject inverted or over-366-day ranges, and filter before the 25-row page slice. Only confirmed `day_utc` is compared. Date-only and unzoned source text always has a null UTC day and remains in **Unresolved UTC dates**; neither text parsing nor a guessed offset assigns a comparison day.

Announcements without a confirmed UTC date remain a separate, counted group. An explicit **Include unresolved dates** control defaults to true and determines whether they remain visible. The control explains that they cannot be tested against the range. An invalid deep-linked date range shows an inline error until corrected. Unknown-date and outside-window counts remain separate, so the UI cannot imply that all pending announcements fall inside the current window.

## Coverage, freshness and compatibility

The main panel keeps the last successful source check, bounded display window, displayed/eligible/clipped count and pending/unresolved-date count compact. Source scope, independent calendar/canonical cutoffs and identities, collection/selection clocks, last publication change, build clock and error details expand on demand. Attribution remains visible. A current calendar does not silently renew an independently older canonical publication. A fresh build does not renew source-check age, and a source check does not prove complete event coverage.

Continue exact inventory, byte/checksum, logical identity and typed validation before accepting a changed package. Only full equality with the previously verified manifest can reuse accepted bodies. Invalid, failed or deploy-racing updates retain the coherent last-good package with a stale warning; never combine old event metadata and new cards without an explicit validated relationship. Public mode fetches only own-site publication files and never probes private calendar/API routes, synthetic fixtures or CC0 assets from this workspace.

Keep v1 validation intact. Normalize an accepted v1 package into a clearly marked **Match-only source publication** presentation: resolved UTC cards and date filtering work, but event hierarchy and unresolved-announcement coverage are **Unavailable in this publication**, not zero. Preserve its identities, source clocks and original provenance. Missing v2 fields must not be filled from the synthetic showcase, CC0 research, private source archives or guessed names.

## Accepted wire and rendering bounds

| Required concept | Accepted contract |
| --- | --- |
| Event identity and hierarchy | Opaque stable provider-scoped IDs, kind, nullable supplied parent, full name/name/season/year; at most 1,500 displayed-card/ancestor nodes |
| Nullable announcement | Stable opaque identity, optional explicit canonical/display link, nullable rivals, supplied status and pending/conflict reasons |
| Time and date filtering | Exact UTC versus source date/unzoned/unknown precision; only nonnull confirmed UTC day enters range comparisons |
| Results | Explicit confirmation/provisional/unavailable state, nullable scores and format; no result inferred from source defaults |
| Scope and clocks | Separate canonical/calendar provenance, successful check, known-window/unknown-date/clipped/pending counts and recovery state |

## Acceptance and implementation gates

1. Two same-name tournaments remain distinct through league → series → tournament → match navigation, reload and browser history; football remains a truthful competition-only hierarchy.
2. Nullable rival, unknown/date-only/unzoned kickoff, missing format, unknown status and conflicting result cases render explicit uncertainty without fake teams, UTC, scores or schedule status.
3. Event + literal search + status + inclusive dates + undated choice filter before pagination, with local/public parity, invalid-range handling and persistent URLs.
4. Pending and unknown-window counts agree with the verified package; independent publication clocks, stale checks, failed refresh, last-good retention and v1 adaptation remain honest.
5. Current pages make zero API/model/Gold/synthetic/CC0 requests in public mode. Original synthetic, CC0 research, public no-model and local canonical question journeys continue to pass.
6. Desktop and 390px mobile show a match in the initial fresh-state viewport. Collapsed mobile filters keep navigation usable; 320px width, long Unicode names, nullable metadata, keyboard focus, Escape/focus return and zero document overflow are tested.

The implementation uses discriminated TypeScript wire versions and a separate validated rendering model. V1 adaptation leaves accepted wire bodies and fingerprints unchanged and marks absent calendar/directory/pending coverage unavailable. The current route stays lazy; at most 25 match rows and 25 event rows render per page. Native labelled controls and modal dialogs preserve keyboard navigation and focus return; browser tests do not claim assistive-technology certification. Original TEST ONLY fixtures cover the edge cases above; actual permitted source/publication screenshots and release gates are measured separately.

V2 card order is running first (known clocks ascending, unknown last), scheduled with known UTC clocks next ascending, remaining unresolved dates by opaque ID, then remaining known-clock statuses descending. Every tie uses opaque identity. V1 order and fingerprints retain their original rules.

Names and full names are bounded at 240 characters, node labels and seasons at 120, years at 1900–2200, source date text at 100, cards at 500 and nodes at 1,500. V2 permits supplied Best of 1–101 and source-reported scores 0–1000. Canonical final/provisional scores retain the canonical 0–50 limit; v1 retains Best of 1–9.

Canonical-only football and verified legacy recovery use `canonical_record` association. A canonical-only final needs nonnull canonical provenance, finished status, known teams, nonfuture UTC kickoff, bounded matching scores and no conflict; football uses validated resolution without calendar, and legacy uses legacy resolution without calendar/publication or directory. Paired PandaScore finals require validated resolution and `matches_latest_announcement`. Historical association cannot fill current fields or convert source-reported scores to final results.
