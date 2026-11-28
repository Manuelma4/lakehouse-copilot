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

### Check which datasets the local API serves

With the API running, query the two dataset endpoints from another terminal.
Vite and Ollama can remain stopped.

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/api/health
curl --fail --silent --show-error http://127.0.0.1:8000/api/open-football/health
```

Both report `snapshot_verified`, `dataset_version`, `snapshot_fingerprint` and
`as_of` for their own package. When checking an unexpected dataset, compare the
version and fingerprint with the intended artifact. The canonical endpoint
reports `ollama_status: "not_checked"`. The OpenFootball endpoint reports
`predictions_available: false` and returns HTTP 503 if its package is missing.
These checks cover the Python API's loaded packages. The [static preview](#preview-the-static-web-build)
has its own exported assets.

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

The validator reports missing roots, broken root links and invalid parent paths
through the same `SnapshotError` contract as malformed package contents.

Import from the repository root with the project environment active. Keep
provider snapshots and state in ignored local directories.

```bash
arena-copilot --state data/private-import ingest data/input/producer-snapshot
```

The [contract](../CONTRACT.md) validates paths, checksums, schemas, distributions
and temporal cutoffs. Ingest validates the source, copies it into the state
directory and validates the copy before recording it in that state's `ACTIVE`
file. Imports sharing a state directory keep separate validated copies.
The last successful pointer update records its copy in `ACTIVE`.
To serve an imported package, pass the absolute path printed by that import.

```bash
arena-copilot --state data/private-import --snapshot "/path/reported/by/ingest" serve
```

`serve` selects its snapshot via `--snapshot`, then `ARENA_SNAPSHOT`, then the
bundled showcase. It does not read the `ACTIVE` file for selection. Restart the
local API to switch a running instance to a different snapshot.

### Check that an invalid import preserves the activation record

Use the bundled synthetic showcase and a fresh ignored state directory. The
following checks the recorded copy after a second import fails validation.

```bash
(
  set -euo pipefail
  mkdir -p data
  scratch=$(mktemp -d data/ingest-check.XXXXXX)
  state="$scratch/state"
  source=src/arena_copilot/showcase
  arena-copilot --state "$state" ingest "$source"
  cp "$state/ACTIVE" "$scratch/active-before"
  cp -R "$source" "$scratch/invalid"
  printf '\n' >> "$scratch/invalid/bronze/events.jsonl"
  if arena-copilot --state "$state" ingest "$scratch/invalid" > "$scratch/rejected.log" 2>&1; then
    printf 'Invalid snapshot unexpectedly accepted\n' >&2
    exit 1
  fi
  grep -qi checksum "$scratch/rejected.log"
  cmp "$scratch/active-before" "$state/ACTIVE"
  arena-copilot --snapshot "$(cat "$state/ACTIVE")" validate >/dev/null
)
```

The changed file belongs to a disposable copy. The last command validates the
path recorded by the successful ingest. This check leaves the API stopped.

### Export a public web asset

The public web exporter selects the bundled synthetic showcase by default.
It takes a separate `--snapshot` argument for another eligible synthetic
package. To review an export alongside the existing web asset, use an ignored
output path.

```bash
python scripts/export_web_snapshot.py --output data/web-export/showcase.json
```

Omit `--output` to regenerate `web/public/snapshot.json`. The public export
accepts original synthetic snapshots only. Keep fetched provider data private.
The static site uses the same observed competition and point-in-time match
semantics as the API.

### Check saved packages in another reader environment

Use the same Copilot revision and the same package directories for each reader
environment. With the project's Python environment active, pass two saved Arena
packages to the validator and record the version and validated identities:

```bash
python - /path/to/first-snapshot /path/to/second-snapshot <<'PYTHON'
import sys
from importlib.metadata import version
from pathlib import Path
from arena_copilot.snapshot import snapshot_fingerprint, validate_snapshot

print(f"Python {sys.version.split()[0]}, PyArrow {version('pyarrow')}, Pydantic {version('pydantic')}")
for directory in sys.argv[1:]:
    package = Path(directory)
    manifest = validate_snapshot(package)
    print(package.name, manifest["dataset_version"], snapshot_fingerprint(manifest))
PYTHON
```

A successful read verifies the package against the snapshot contract and does
not activate it. For a negative control, repeat the check on a disposable copy
with a payload changed and the manifest left intact. Expect a checksum error
and retain the original package. To compare writers, compare decoded schemas
and rows separately. These controls establish acceptance for the specific
reader versions and artifacts tested.

### OpenFootball export

The independent OpenFootball CC0 research fixture is bundled separately. Its
default API path is `src/arena_copilot/research_fixture`; `ARENA_OPEN_FOOTBALL`
can select another validated research package. `scripts/export_openfootball.py`
generates `web/public/open-football.json`. This exporter verifies its own
contract and source allowlist; it does not relax the synthetic export guard.
The [research contract](openfootball-research.md) documents its source dates,
unknown scores, poll history and disabled forecasting.

## Preview the static web build

The static build needs two generated JSON assets. From the repository root,
with the project Python environment active, export both bundled packages before
building the web app.

```bash
python scripts/export_web_snapshot.py
python scripts/export_openfootball.py
cd web
npm ci
VITE_STATIC_DEMO=true npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. The exporters write the ignored files
`web/public/snapshot.json` and `web/public/open-football.json`. Vite copies them
into the build output, where the static workspaces read them under the built
base path. Re-export and rebuild if a published workspace shows stale data.
The preview uses the synthetic showcase and the separate CC0 research package.

## Production container

```bash
docker compose up --build
```

The image builds React and serves its assets alongside FastAPI on
`http://127.0.0.1:8000`. Compose persists state and resolves host Ollama through
`host.docker.internal` for optional inference.

### Check the built container locally

Use an isolated Compose project so the smoke's chat and feedback records stay
in its volume. Run this from the repository root with the project Python
environment active. Stop other services using host port 8000 first.

```bash
(
  set -eu
  docker compose -p arena-smoke up --build -d
  mkdir -p data
  smoke_out="$(mktemp -d data/container-smoke.XXXXXX)"
  python scripts/smoke_container.py --url http://127.0.0.1:8000 --output "$smoke_out/report.json"
  printf 'Container smoke report: %s\n' "$smoke_out/report.json"
)
```

The explicit URL matches the Compose host port. The smoke checks bundled
synthetic and OpenFootball assets, API responses, evidence-mode chat and stored
feedback. It checks that a research forecast request abstains without generating
tokens. These checks do not need Ollama or MLflow. A failed assertion can stop
the script before it writes a report, so also check the command's exit status.
Use `docker compose -p arena-smoke down` to stop the test project.

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

From the repository root, with the Python environment active, install the
observability extra and generate one trace with the bundled synthetic showcase.

```bash
python -m pip install -e '.[dev,observability]'
(
  set -eu
  mkdir -p data
  trace_dir="$(mktemp -d data/mlflow-local.XXXXXX)"
  export MLFLOW_TRACKING_URI="sqlite:///$trace_dir/traces.db"
  export MLFLOW_EXPERIMENT_NAME=arena-synthetic-trace
  arena-copilot --snapshot src/arena_copilot/showcase --state "$trace_dir/copilot" \
    ask 'Show VALORANT team win rates' --mode evidence --retrieval lexical
  mlflow server --backend-store-uri "$MLFLOW_TRACKING_URI" \
    --default-artifact-root "$trace_dir/artifacts" --host 127.0.0.1 --port 5000 --workers 1
)
```

At `http://127.0.0.1:5000`, open the `arena-synthetic-trace` experiment. Look
for `arena.request` with `arena.retrieve` and `arena.answer` spans. The example
uses lexical retrieval in evidence mode and needs no Ollama model. The application
also keeps its own SQLite trace ledger under `--state`. Both stores can contain
questions, answers and evidence, so keep the generated directory local and ignored.
The [recorded MLflow smoke](evidence/observability-smoke.json) verifies span
creation with a synthetic question. It does not measure answer quality.

The [evaluation guide](../evaluation/README.md) gives lexical and hybrid commands
with separate report paths. Its 120 draft cases await human semantic review.
Retrieval recall, citation membership and source support are different
measurements. The tiny document corpus cannot establish hybrid superiority.
[Measured evidence](evidence/README.md) separates fixtures, embeddings, actual
inference and optional MLflow spans.

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
