# Measured evidence and verification boundaries

Reports preserve their original date/configuration; older milestone reports are
historical evidence rather than claims that every dependency is still unchanged.

| Evidence | Scope and result | Boundary |
|---|---|---|
| [v0.7 current calendars](current-calendar-v0.7.json) | 297 local Python tests passed; original browser profiles retained, with two date-panel failures corrected and rechecked; strict capture identity and source parity | Local published profile was not rerun in full after correction; remote final-source CI and actual deployed acceptance are separate |
| [v0.7 isolated wheel](current-wheel-v0.7.json) | Exact packaged bytes, RECORD, text-only README, both fixtures, four-stage mock bridge and corrected read-only API probe passed | Original combined and first API-only harness failures retained; existing dependencies reused; no provider/model/Spark calls |
| [v0.6 current software](current-software-v0.6.json) | 237 final local tests passed, one Windows symlink privilege skip; Ruff passed; current completion-bound UI regression passed | Offline fixtures/model doubles; Linux CI exercises the skipped case |
| [v0.6 isolated wheel](current-wheel-v0.6.json) | Packaged bytes/resources, 0.6.0 imports, original/CC0 fixture validation and 62 API paths passed | No provider/model/Spark execution or shared installation |
| [v0.6 actual processed-display browser](current-display-browser-v0.6.json) | Real 263 football / 41 VALORANT cards, desktop/mobile, credits, unavailable scheduled scores, reload/Escape and zero overflow/errors | Locally built public profile; actual deployed Pages acceptance is separate |
| [v0.6 full browser regression](current-browser-v0.6.json) | 57 applicable Chromium cases passed, 17 intentional profile skips, zero failures/retries | One local execution each; repeated remote CI and deployed Pages acceptance are separate |
| [v0.5 World Cup software](worldcup-software-verification-v0.5.json) | 84 local tests and Ruff passed; genuine v1 regression, v2 trusted raw-source facts, numeric-offset rollover, derived team coverage and separate chat/feedback | Fixtures and model doubles; actual inference and browser/container checks are separate |
| [v0.5 Linux container](worldcup-container-verification-v0.5.json) | Fresh production image passed World Cup clocks/stages, team profiles, separate chat/feedback, forecast abstention and static/API parity | Evidence mode; exact image identity retained; no container inference |
| [v0.5 source inference attempts](worldcup-model-smoke-v0.5-initial.json) | Actual cited Qwen answers preserved for UTC rollover and Mexico imported coverage | Mixed score/forecast prompt triggered an explicit pre-model abstention; report retains that failed inference expectation |
| [v0.5 final score inference](worldcup-final-model-smoke-v0.5.json) | Actual Qwen kept Spain/Argentina FT 0–0 and ET 1–0 separate, with source citations and stable before/after model digest | One selected-source example; not a human-reviewed semantic scorecard |
| [v0.5 missing digest attempt](worldcup-final-model-smoke-v0.5-digest-missing.json) | Correct cited score answer, but best-effort digest lookup returned null and the smoke failed its metadata gate | Preserved failure; final harness captures installed digest before/after without changing agent runtime |
| [v0.5 independent source review](worldcup-independent-source-verification-v0.5.json) | Agent-reviewed 104-row raw source anchors, clocks, stages and publisher resealing regressions | Community-source fidelity; not official FIFA or human annotation |
| [v0.5 answer review](worldcup-agent-semantic-review-v0.5.json) | Independent agent supported the three actual Qwen answers against selected source fields | Three examples; explicitly not human-reviewed or a general quality scorecard |
| [v0.5 browser verification](worldcup-browser-verification-v0.5.json) | Full 28-case regression and 90 new executions passed; each of nine project/journey cases passed ten times, zero retries and unchanged inputs | Quiet-host measurement; earlier incomplete timeout retained; remote CI and actual deployed website are separate |
| [v0.4 OpenFootball software](openfootball-software-verification-v0.4.json) | 61 local tests and Ruff passed; independent checksum/parity/identity/poll validation, source-date filtering and verified in-memory queries | Offline fixtures; network acquisition and browser checks are separate |
| [v0.4 OpenFootball browser](openfootball-browser-verification-v0.4.json) | Full 19-case regression and 60 new journey executions passed locally, zero retries; desktop/mobile captures | Browser runs preceded final importer hardening; final backend software/container and remote CI checks are separate |
| [v0.4 OpenFootball container](openfootball-container-verification-v0.4.json) | Actual rebuilt Linux production image passed separate CC0 health/API/static assets, unknown-score/clock checks and synthetic chat/feedback | No model inference; real research forecasts remain unavailable |
| [v0.3 browser verification](browser-verification-v0.3.json) | 130 local executions passed; 13 desktop/mobile project cases each passed ten consecutive times, zero retries, unchanged source hashes | Actual API/static Chromium journeys; inference and CI are separate |
| [v0.3 software checks](software-verification-v0.3.json) | 44 local tests and Ruff passed; competition arithmetic, observation cutoffs, stable IDs, outcome association and bounded research tools | Fixtures; actual inference and browser journeys are separate |
| [v0.3 forecast inference](prediction-model-smoke-v0.3.json) | Actual Qwen3:4b response on the six-competition showcase with precise stored percentages and citations | One synthetic forecast smoke; not a semantic scorecard |
| [v0.3 container](container-smoke-v0.3.json) | Built Linux web/API image passed asset, six-competition, history, maps, context, citation and feedback checks | Evidence mode; inference measured separately |
| [v0.3 planner abstention](match-context-model-smoke-v0.3-before-routing.json) | Explicit match-context question produced no tool call before fixed-ID routing | Retained actual-model failure |
| [v0.3 context route before guidance](match-context-model-smoke-v0.3-before-guidance.json) | Fixed-ID routing returned cited context, but the model answer only repeated a title | Tool/citation smoke passed; answer usefulness did not |
| [v0.3 match-context inference](match-context-model-smoke-v0.3.json) | Actual Qwen answer reports the recorded cutoff, each team's form counts and head-to-head evidence | One actual example after explicit field guidance; broader semantic evaluation remains pending |
| [Browser verification](browser-verification.json) | Final five-case regression passed; every case passed ten consecutive executions locally; original diagnosed mobile selector failure is documented | Chromium; no inference, screen-reader review or full WCAG claim |
| [Screenshots](../images/) | Actual Playwright desktop/mobile captures of public and live modes | Synthetic historical fixture, not real-time teams |
| [Container smoke](container-smoke.json) | Actual built Linux React/FastAPI container, assets, analytics, citations and feedback | Evidence mode; native Ollama and MLflow measured separately |
| [Producer compatibility](producer-compatibility.json) | Copilot validates and reads the actual incremental Spark export | Contract integration and evidence tools, not forecasting accuracy |
| [Retrieval comparison](retrieval-evaluation.json) | Actual Nomic vectors: lexical/dense/RRF Recall@5 = 1.0 on development and holdout | Only eight documents and 60 draft documentary cases; saturated result |
| [MLflow spans](observability-smoke.json) | Actual MLflow OSS request/retrieval/answer spans in a local SQLite store | Evidence mode, not a generative evaluation |
| [Original software checks](software-verification.json) | First milestone's 15 tests and code checks | Historical. The development guide has current local commands |
| [v0.2 software checks](software-verification-v0.2.json) | 22 local tests and Ruff passed, including precise forecast rejection/acceptance and checkpoint restart | Fixtures and model doubles; optional historical Streamlit test included locally |
| [Original document inference](local-model-smoke.json) | Actual Qwen3:4b citation-bearing response and recorded CPU latency | One actual-inference example, not a scorecard |
| [Failed prediction route](prediction-model-smoke-before-routing.json) | Initial native tool planner abstained despite explicit match ID | Retained failure, not removed from the record |
| [Original successful VALORANT route](prediction-model-smoke.json) | Actual fixed-ID tool and correct stored probabilities | One smoke; no real-team accuracy claim |
| [Original football route](football-model-smoke.json) | Actual A/draw/B explanation, evidence, digest and latency | One smoke; no calibration or winning guarantee |
| [Rejected v0.2 rounding](prediction-model-smoke-v0.2-before-format.json) | The model rounded 33.7068/66.2932 to 34/66; the numerical guard rejected the answer | Preserved failure before adding verified display percentages |
| [v0.2 VALORANT inference](prediction-model-smoke-v0.2.json) | Actual local Qwen copied precise 33.71/66.29 percentages and cited the stored forecast | Numerical smoke, not broad semantic evaluation |
| [v0.2 football inference](football-model-smoke-v0.2.json) | Actual local three-outcome forecast smoke on the current prompt | Stored synthetic probabilities; not real-team validation |
| [Notebook execution](notebook-smoke.json) | Explanatory notebook code cells executed | Optional inference cell stays commented |

The original [120-case draft](../../evaluation/README.md) has the requested
60/20/20/10/10 category distribution. It is not described as human-reviewed.
Retrieval Recall@5, valid citation membership and semantic answer support are
different measurements; the first two do not prove the third.

The [source agent design](../research-agent.md) and [World Cup/team interface](../worldcup-ui.md)
describe the independent real-data workflow. Source clocks with explicit numeric
offsets become UTC instants; other clocks and every completion instant remain
unknown. All research records remain prediction-ineligible.

The inference path uses one local request at a time. CPU latency is recorded in
the actual reports. Keep Spark and generation in separate stages on the 16 GB
development host. The explicit evidence browser is excluded from inference
evaluation and never silently replaces unavailable generation.

The public source includes the fictional showcase, the independently verified
OpenFootball CC0 package and the reports linked above. The
[development guide](../development.md#verification) gives local verification
commands. The [source attribution](../../DATA_SOURCES.md) records the downloaded
editions, licenses and partial coverage.
