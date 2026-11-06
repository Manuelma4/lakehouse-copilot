# Development reference

Requirements: Python 3.11 and Node.js 24. Docker uses Linux containers. Ollama is
optional for evidence browsing; local generation requires the models below.

## Local application

From the repository root on Windows:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\arena-copilot.exe validate
.\start-demo.ps1
```

The web application uses `http://127.0.0.1:5173`; API documentation is at
`http://127.0.0.1:8000/docs`. `stop-demo.ps1` stops only recorded Arena services.
The launcher installs web dependencies if needed and exports the verified public
asset before starting the API and Vite.

Linux/macOS, from the repository root:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python scripts/export_web_snapshot.py
.venv/bin/python scripts/export_openfootball.py
.venv/bin/arena-copilot serve
```

In a second terminal:

```bash
cd web
npm ci
npm run dev
```

The default showcase has 600 fictional matches, 16 teams and six competitions.
The original single-competition fixture is retained separately for historical
verification. Both use contract-validated, immutable exports.

## Generation and retrieval

```bash
ollama pull qwen3:4b
ollama pull nomic-embed-text:137m-v1.5-fp16
# Activate the Python environment first:
arena-copilot index
```

Select Local AI in Ask Arena. Hybrid retrieval requires indexed Nomic vectors.
Inference allows one request at a time, temperature zero, thinking disabled and
a 4,096-token context. Explicit failures distinguish missing models, embeddings,
concurrency limits and deadlines. Evidence mode is a separate operating mode.
Keep CPU inference and Spark in separate stages on a 16 GB machine.

## Snapshot imports and public export

```bash
arena-copilot ingest /path/to/producer/snapshot
# Set ARENA_SNAPSHOT in .env to the validated copy reported above.
python scripts/export_web_snapshot.py
```

The [contract](../CONTRACT.md) validates paths, checksums, schemas, distributions
and temporal cutoffs before activation. Imports create independent copies.
Public asset export accepts original synthetic snapshots only; fetched provider
data is not automatically republished. The static site uses the same observed
competition and point-in-time match semantics as the API.

The independent OpenFootball CC0 research fixture is bundled separately. Its
default API path is `src/arena_copilot/research_fixture`; `ARENA_OPEN_FOOTBALL`
can select another validated research package. `scripts/export_openfootball.py`
generates `web/public/open-football.json`. This exporter verifies its own
contract and source allowlist; it does not relax the synthetic export guard.
The [research contract](openfootball-research.md) documents its source dates,
unknown scores, poll history and disabled forecasting.

## Production container

```bash
docker compose up --build
```

The image builds React and serves its assets alongside FastAPI on
`http://127.0.0.1:8000`. Compose persists state and addresses host Ollama through
`host.docker.internal`; the host service must accept that connection. The
container smoke verifies web/API/evidence mode. Native model inference is
measured separately.

## Verification

```bash
python -m pytest -q
python -m ruff check src tests scripts evaluation
python scripts/export_web_snapshot.py
python scripts/export_openfootball.py
cd web
npm ci
npm run check
npm run format:check
npx playwright install chromium
npm run test:e2e -- --repeat-each=10
```

Browser tests cover actual API and static subpath builds, competition/date/team
filters, history boundaries, deep links, evidence, feedback, failures and mobile
navigation. They do not simulate successful inference. Verification reports keep
the source version and fixture identity alongside measured results.

## Optional observability and evaluation

```bash
pip install -e '.[dev,observability]'
# Configure in .env before starting the API:
# MLFLOW_TRACKING_URI=sqlite:///data/mlflow.db
# MLFLOW_EXPERIMENT_NAME=arena-copilot-local
mlflow ui --backend-store-uri sqlite:///data/mlflow.db --host 127.0.0.1 --port 5000
python scripts/evaluate_retrieval.py --hybrid
```

The [evaluation corpus](../evaluation/README.md) contains 120 draft cases awaiting
human semantic review. Retrieval recall, citation membership and source support
are different measurements. The tiny document corpus cannot establish hybrid
superiority. [Measured evidence](evidence/README.md) separates fixtures, embeddings,
actual inference and optional MLflow spans.

## Source research verification

The default research fixture uses contract 2.0; the reader also accepts legacy
1.0 packages without migration. Source-team and match questions use the separate
`/open-football/chat` endpoint. Evidence mode requires no Ollama request.

To record actual local model examples after software checks, with Ollama running:

```bash
python scripts/smoke_research_model.py --output data/research-model-smoke.json
# Select one example when diagnosing a specific failure:
python scripts/smoke_research_model.py --case final-score-stages --output data/final-score-smoke.json
```

The script preserves full responses, selected source facts, model digest before
and after inference, configuration and latency. Its integration checks do not
replace semantic review. Preserve failed output under a separate filename.
Run CPU inference and browser stability measurements in separate phases on a
16 GB machine; keep Docker builds and Spark out of the browser measurement phase.
