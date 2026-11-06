# Source-scoped football investigations

The research agent consumes only the verified OpenFootball package. It is a
separate LangGraph workflow and checkpoint/trace ledger; its tools cannot read
the synthetic showcase's forecasts or write lakehouse tables.

An API request selects at most one match, team or edition. The gather node reads
that context through a fixed tool before generation. A request without context
can use the local model's typed tool planner. The answer node receives the
evidence, validates structured citation IDs and persists the response with the
research dataset version and complete fingerprint.

| Tool | Bounded result |
| --- | --- |
| `research_match` | One match's source stages, clock precision and revision scope |
| `research_team` | Imported coverage counts and at most three recent source records |
| `research_competition` | One edition's coverage and participant count |
| `research_matches` | At most five current records through fixed filters |
| `research_quality` | Validated package quality counts and limitations |
| `research_sources` | Reviewed source references and licenses |

Tool arguments are typed and reject unknown fields. There is no arbitrary SQL
or remediation execution. A request has a six-tool limit and shares the
canonical agent's deadline and single-flight model slot. Generation uses
Qwen3:4b through Ollama with temperature zero, a 4,096-token context and thinking
disabled. Unavailable generation returns an explicit API error.

The model must distinguish FT, HT, ET and penalties. It may explain the supplied
numeric offset without inventing an IANA timezone or completion instant. Team
counts describe imported source coverage. A forecast request returns a cited
quality abstention before model invocation because these retrospective records
do not establish historical pre-match availability.

`mode=evidence` reads the same typed tools without calling a model. Public source
summaries are also deterministic and do not contact the local API. They are
excluded from actual-inference evaluation. Public feedback is unavailable; local
research feedback accepts only trace IDs in the research ledger.

The answer validator enforces citation membership and rejects unsupported
percentage assertions. It does not prove semantic truth. Actual local model
examples record the question, expected source facts, response, tools, digest,
prompt, dataset, configuration and latency. Independent semantic review and
the planned human-reviewed 120-case scorecard remain separate acceptance gates.
