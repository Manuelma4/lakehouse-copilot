"""Verify actual MLflow OSS parent/child spans without calling a generative model."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

os.environ["MLFLOW_TRACKING_URI"] = "sqlite:///" + str((Path("data") / "mlflow.db").resolve()).replace("\\", "/")
os.environ["MLFLOW_EXPERIMENT_NAME"] = "arena-local-verification"

import mlflow
from mlflow import MlflowClient

from arena_copilot.agent import Copilot
from arena_copilot.snapshot import default_fixture

agent = Copilot(default_fixture(), Path("data/observability-smoke"))
answer = agent.ask("Show VALORANT team win rates", mode="evidence")
mlflow.flush_trace_async_logging()
client = MlflowClient()
experiment = client.get_experiment_by_name(os.environ["MLFLOW_EXPERIMENT_NAME"])
traces = client.search_traces(experiment_ids=[experiment.experiment_id], max_results=10)
trace = next(t for t in traces if t.info.tags.get("mlflow.traceName") == "arena.request")
names = [s.name for s in trace.data.spans]
assert {"arena.request", "arena.retrieve", "arena.answer"} <= set(names)
report = dict(status="verified_locally", recorded_at=datetime.now(timezone.utc).isoformat(),
              mlflow=mlflow.__version__, storage="MLflow OSS SQLite", span_names=names,
              arena_trace_id=answer["trace_id"], scope="Actual telemetry smoke in evidence mode; no model inference")
Path("docs/evidence/observability-smoke.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8", newline="\n")
agent.close()
print(json.dumps(report))
