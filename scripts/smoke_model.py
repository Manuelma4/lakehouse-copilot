"""Record one actual local inference; this is not the full agent evaluation."""

import argparse
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import httpx

from arena_copilot.agent import Copilot
from arena_copilot.snapshot import default_fixture

parser = argparse.ArgumentParser()
parser.add_argument("--question", required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--expect-prediction", action="store_true")
args = parser.parse_args()
agent = Copilot(default_fixture(), Path("data/model-smoke"))
models = httpx.get(agent.base_url.rstrip("/") + "/api/tags", timeout=10).json()["models"]
digest = next((m["digest"] for m in models if m["name"] == agent.model), None)
response = agent.ask(args.question, mode="ollama")
passed = not response["abstained"] and bool(response["citations"])
if args.expect_prediction:
    passed = passed and any(t["tool"] == "get_prediction" and t.get("rows") for t in response["tool_results"])
report = dict(scope="Single actual-inference smoke; not a human-reviewed evaluation scorecard",
    recorded_at=datetime.now(timezone.utc).isoformat(), platform=platform.platform(),
    question=args.question, model_digest=digest,
    configuration=dict(temperature=0, context_tokens=4096, thinking=False, concurrent_requests=1),
    status="passed" if passed else "failed", response=response)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps(dict(status=report["status"], answer=response["answer"], metrics=response["metrics"])))
raise SystemExit(0 if passed else 1)
