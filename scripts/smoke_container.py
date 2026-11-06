"""Check an already-running production web/API container; no model inference."""

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from arena_copilot import __version__

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8001")
parser.add_argument("--output", type=Path, default=Path("data/container-smoke.json"))
args = parser.parse_args()
client = httpx.Client(base_url=args.url, timeout=15)
deadline = time.monotonic() + 45
while True:
    try:
        health = client.get("/api/health")
        health.raise_for_status()
        break
    except httpx.HTTPError:
        if time.monotonic() >= deadline:
            raise
        time.sleep(1)
index = client.get("/")
index.raise_for_status()
assets = re.findall(r'(?:src|href)="([^"]+)"', index.text)
checks = {path: client.get(path).status_code for path in assets}
checks["/snapshot.json"] = client.get("/snapshot.json").status_code
checks["/api/overview?sport=valorant"] = client.get("/api/overview?sport=valorant").status_code
assert all(status == 200 for status in checks.values()), checks
snapshot = client.get("/snapshot.json").json()
assert len(snapshot["matches"]) == 600
assert len(snapshot["match_history"]) == 1192
assert len(snapshot["competitions"]) == 6
events = client.get("/api/competitions", params={"sport": "valorant"})
events.raise_for_status()
event_rows = events.json()["rows"]
assert len(event_rows) == 3
event_detail = client.get(f"/api/competitions/{event_rows[0]['competition_id']}")
event_detail.raise_for_status()
event = event_detail.json()
assert event["competition"]["score_unit"] == "maps"
assert all(team["points"] is None for team in event["table"])
context_result = client.get("/api/matches/synthetic:football:000590")
context_result.raise_for_status()
context = context_result.json()
assert context["history_basis"] == "observation_history"
assert context["form_a"]["played"] <= 5 and context["form_b"]["played"] <= 5
result = client.post("/api/chat", json={"question": "Show football team win rates", "mode": "evidence"})
result.raise_for_status()
reply = result.json()
assert reply["citations"] and reply["tool_results"]
feedback = client.post("/api/feedback", json={"trace_id": reply["trace_id"], "rating": 1})
feedback.raise_for_status()
research = client.get("/api/open-football/snapshot")
research.raise_for_status()
source = research.json()
assert source["manifest"]["research_version"] == "openfootball-research-2.0"
assert len(source["matches"]) == 2831 and len(source["teams"]) == 261
world = [row for row in source["matches"] if row["edition_id"] == "worldcup-2026"]
assert len(world) == 104
assert len([team for team in source["teams"] if team["team_type"] == "national"]) == 48
final = next(row for row in world if row["source_match_number"] == 104)
assert json.loads(final["score_details_json"]) == {"ft": [0, 0], "ht": [0, 0], "et": [1, 0]}
rollover = next(row for row in world if row["team_a"] == "South Korea" and row["source_date"] == "2026-06-11")
assert rollover["local_time"] == "20:00" and rollover["utc_offset_minutes"] == -360
assert rollover["start_time"] == "2026-06-12T02:00:00.000000Z"
assert rollover["timezone"] is None and rollover["completed_at"] is None
mexico = next(team for team in source["teams"] if team["team_name"] == "Mexico")
profile_result = client.get(f"/api/open-football/teams/{mexico['team_id']}")
profile_result.raise_for_status()
profile = profile_result.json()
assert profile["team"]["record_count"] == 5 and profile["team"]["unknown_results"] == 0
source_answer = client.post("/api/open-football/chat", json={"question": "Inspect the source score stages",
    "mode": "evidence", "match_id": final["match_id"]})
source_answer.raise_for_status()
source_reply = source_answer.json()
assert source_reply["dataset_version"] == source["manifest"]["dataset_version"]
assert source_reply["snapshot_fingerprint"] == source["snapshot_fingerprint"]
assert source_reply["model"] is None and source_reply["metrics"]["generated_tokens"] == 0
assert source_reply["tool_results"][0]["rows"][0]["match_id"] == final["match_id"]
source_feedback = {"trace_id": source_reply["trace_id"], "rating": 1}
client.post("/api/open-football/feedback", json=source_feedback).raise_for_status()
assert client.post("/api/feedback", json=source_feedback).status_code == 400
forecast = client.post("/api/open-football/chat", json={"question": "Predict Mexico's next match", "mode": "ollama"})
forecast.raise_for_status()
assert forecast.json()["abstained"] and forecast.json()["metrics"]["generated_tokens"] == 0
static_source = client.get("/open-football.json")
static_source.raise_for_status()
assert static_source.json()["snapshot_fingerprint"] == source["snapshot_fingerprint"]
report = dict(recorded_at=datetime.now(timezone.utc).isoformat(), status="passed",
    application_version=__version__, scope="Actual Linux Docker production web/API container, evidence mode; "
    "Ollama inference and MLflow not tested in this container", checks=checks, health=health.json(),
    fixture_matches=len(snapshot["matches"]), competitions=len(snapshot["competitions"]),
    revision_rows=len(snapshot["match_history"]), event_maps_verified=True,
    historical_context_verified=True, cited_chat=True, stored_feedback=True,
    research=dict(dataset_version=source["manifest"]["dataset_version"], fingerprint=source["snapshot_fingerprint"],
        records=2831, editions=10, national_teams=48, worldcup_records=104, source_clock_rollover=True,
        source_stages_separate=True, mexico_coverage=True, separate_chat_feedback=True,
        forecast_abstention_before_model=True, static_api_parity=True),
    openapi_version=client.get("/openapi.json").json()["info"]["version"])
assert report["openapi_version"] == __version__
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
