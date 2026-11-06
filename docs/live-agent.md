# Current-data investigations

`LiveCopilot` investigates a verified `football-data` or `pandascore` publication. It cannot contact a provider,
read the synthetic showcase, run arbitrary SQL, train a model, or create predictions. REST source checks and
canonical fixture/result updates are distinct from in-game round telemetry.

## Request and response contract

The service API is `LiveCopilot(registry, model_api, state)`. `ask(provider, question, mode="ollama", match_id=None,
team_id=None)` requires one supported provider, a question of at most 2,000 characters, and at most one context.
The HTTP adapter registers the proposed `/live/chat` route separately from synthetic and research chat routes.
`mode="evidence"` returns an explicitly labelled deterministic evidence browser and calls no generative model.

Each investigation calls `registry.capture(provider)` exactly once. Its tools, health envelope, response, citations
and durable trace all retain that same immutable publication. A later request may reload a newer publication;
an update during inference cannot silently replace the first request's evidence. The response carries the live
health envelope, answer, citations, tool results, trace ID, prompt version, model metadata and latency/tool counts.
`validation_error_code` is null for accepted responses and ordinary evidence-based abstentions. A rejected model
response carries one fixed diagnostic category; raw model text and exception details are not returned to clients.
The registry samples its capture clock after reading bounded status bytes inside its lock. Waiting for another
capture or an atomic status update cannot make a genuine newly observed poll appear to be from the future.
Status and manifest clocks that actually exceed that post-read capture instant remain rejected.

Every citation binds the provider, dataset version, full snapshot fingerprint and exact source. Match evidence
references `gold/matches.parquet`; health evidence references the captured `LIVE_STATUS.json`. Status is captured
polling metadata, not a file within the canonical manifest, and is not included in the canonical fingerprint.
Its poll timestamps accompany the response. Dataset cutoff is observation availability, not kickoff time or
the time of the latest unchanged source check.

## Read-only tools

| Tool | Bounded evidence |
| --- | --- |
| `live_match` | One current accepted match revision and its known score. |
| `live_matches` | Literal search, exact competition/team/status filters; at most five retained matches. |
| `live_team_form` | Counts of retained matches and completed matches; at most five completed results ordered by source kickoff. |
| `live_quality` | Captured connection/freshness/scope metadata, retained status counts and observation range. |

Team scores are oriented to the selected team. Football scores are goals; VALORANT series scores are maps.
Map wins are not round wins. Current retained form may incorporate later accepted corrections and must not be
used as a historical pre-match feature set. Counts describe retained coverage, not complete team history.
For both providers, form uses descending normalized source kickoff, then descending match ID for ties. Each
returned result includes `start_time`; common collection clocks cannot rank older results by an arbitrary ID.
Completion fields do not determine that ordering.

Completed match evidence includes `completion_time_semantics` and an explicit inference basis. Football's mapper
uses a collection-time `observed_upper_bound`, not the exact final whistle. Under the current PandaScore mapper,
a completion timestamp strictly earlier than observation indicates `source_reported_end`; equal clocks retain
the conservative upper-bound label. The canonical contract has no raw origin flag, so this is mapper inference,
not independent authentication of the source's actual end. Completion-only corrections are not currently
versioned. Exact end or duration requests abstain before inference and explain these bounds; generated end-time
claims require an explicit applicable precision caveat. Scheduled score/kickoff evidence receives no completion
metadata and keeps the separately measured Native04 model-input path unchanged.
Unresolved provider announcements are outside the strict canonical-match tools and require the separate
provider-calendar contract.

Missing publications and missing or foreign identifiers abstain explicitly. Prediction, roster, player, round
telemetry and completeness requests abstain before model inference. Stale or invalid publications may serve the
registry's last good dataset, with its original version and explicit health/error metadata. Neither the agent
nor the registry substitutes synthetic records for missing provider data.

## Agent limits and observability

The LangGraph workflow gathers bounded evidence and produces an answer. The quality call counts toward the
six-tool ceiling. Typed arguments reject unsupported tools, SQL and writes; fixed queries only read the captured
Arrow table. Malformed model output, foreign citation IDs and unsupported claims produce explicit abstention.
The request restriction and answer guard serve different purposes. The answer guard permits narrowly explicit
negative limitations such as "maps won, not rounds"; positive round scores, rosters, predictions or complete
coverage claims remain unsupported. A later positive claim or double negation does not inherit that exception.
For inference, `C1` identifies captured health and `C2` identifies captured match evidence. Only aliases with
actual returned evidence appear in the model's answer schema. The server resolves them to the complete
provider/fingerprint/source citation IDs before validating and returning a response. Exact already-known full
IDs remain accepted for compatibility; unknown aliases and IDs never acquire authority. The public citation
and tool-result contract retains complete provenance, source fields and match identifiers.

The model receives a compact projection of business facts and collection health rather than repeated snapshot
hashes. This projection preserves selected status, exact source kickoff, raw scores, score units, result-known
state, observation timestamps, retained counts, freshness scope and errors. It does not replace the full API
evidence. Bounded list excerpts may omit additional matches; an unavailable excerpt cannot be used as evidence.
The model schema instructs the answer field to contain a factual answer rather than the user's instructions.
Normalized instruction echoes are rejected. For a selected match, a requested kickoff must match its captured
UTC instant; requested non-finished scores require the actual status and an explicit unconfirmed-result caveat.
Stored 0–0 values on a scheduled series do not establish a completed draw. These narrow guards supplement,
rather than replace, separate semantic review.
The existing `model_api` supplies local inference; the shared `model_slot` prevents simultaneous requests across
chat services, and the shared `DEADLINE` bounds inference. MLflow spans reuse the existing observability adapter.
Model digest capture is best effort and is skipped when less than two seconds remain in the request budget.

SQLite checkpoints, traces and feedback live under `state/provider/snapshot_fingerprint/` (or `unavailable`
when no publication exists). A provider-scoped on-disk trace index routes feedback to its original version.
`feedback(provider, trace_id, rating, comment="", snapshot_fingerprint=None)` accepts ratings -1 or 1 and an
optional full-fingerprint guard. Foreign provider traces and wrong versions are rejected. All SQLite connections
close after their operation; the service retains no cache of old graphs, model agents or open version connections.
`close()` prevents new operations. Version ledgers are retained for review; there is no automatic deletion policy.

## Verification scope

Offline tests use original, explicitly TEST ONLY API-labelled fixtures and model doubles. They verify one-capture
consistency, updates during model execution, pending/missing/stale/invalid states, provider isolation, bounded
tools and oriented scores, citation scope, malformed responses, tool limits, deadline/busy cleanup and feedback.
These tests make no provider requests and perform no actual model inference.

Citation validation establishes that a response points to captured evidence. It does not prove that every natural
language statement is semantically entailed by that evidence. Real-model answers require a separate, dated
semantic review against the returned records, with model digest, provider, dataset version and fingerprint.
No human evaluation, accuracy target or live score latency is claimed by the offline suite.

Validation diagnostics distinguish malformed planner/schema output, blank answers, invalid or missing citations,
unsupported claims, instruction echoes, kickoff mismatches, missing status or unconfirmed-score caveats,
unsupported completion precision, missing record evidence and the six-tool limit. These fixed categories are recorded in the durable trace and
MLflow outputs. They describe the server's rejection reason, not the model's reasoning. Capturing raw native
model output for diagnosis belongs in a bounded private verification harness, never in the public API.

The first measured native current-data attempt echoed the question despite valid citations and failed semantic
review. A second attempt abstained through the validation gate; its stored report lacks raw model output and
cannot establish which guard failed. The third private instrumented attempt established an answer-guard false
positive on "maps won, not rounds". Its answer also omitted the required unconfirmed-result caveat; fixing the
unit caveat alone must still reject that response. All three attempts remain failure evidence. Prompt compaction
and model-double regressions do not establish native-model improvement; a new measured native attempt and
separate semantic review are required.
