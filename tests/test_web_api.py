import hashlib
import json
import shutil
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot, MODEL_LOCK
from arena_copilot.api import create_app
from arena_copilot.analytics import public_snapshot
from arena_copilot.snapshot import default_fixture, snapshot_fingerprint, validate_snapshot


def test_web_queries_have_correct_scope_counts_and_parameterized_filters(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    with TestClient(create_app(agent)) as client:
        assert client.get("/matches").json()["total"] == 600
        first = client.get("/matches?limit=5&offset=0").json()
        second = client.get("/matches?limit=5&offset=5").json()
        assert {m["match_id"] for m in first["rows"]}.isdisjoint(m["match_id"] for m in second["rows"])
        assert first["total"] == 600 and first["snapshot_fingerprint"]
        football = client.get("/overview?sport=football").json()
        assert football["summary"]["total_matches"] == 300
        assert football["summary"]["completed_matches"] == 296
        assert football["summary"]["predictions"] == 4
        assert client.get("/teams?team_name=%27%20OR%201%3D1%20--").json()["rows"] == []
        assert all(r["sport"] == "valorant" for r in client.get("/predictions?sport=valorant").json()["rows"])
        assert client.get("/matches?limit=1001").status_code == 422
        assert client.get("/matches?sport=hockey").status_code == 422
        assert client.get("/quality").json()["incidents"]


def test_public_export_is_complete_and_refuses_api_data(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    payload = public_snapshot(agent)
    assert len(payload["matches"]) == 600 and len(payload["teams"]) == 16
    agent.manifest = dict(agent.manifest, data_kind="api", providers=["pandascore"])
    with pytest.raises(ValueError, match="synthetic"):
        public_snapshot(agent)
    agent.close()


def test_snapshot_prediction_comparison_uses_utc_instants(tmp_path):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "predictions.json"
    predictions = json.loads(path.read_text())
    # The same as-of expressed in UTC+2 sorts differently as text.
    instant = datetime.fromisoformat(predictions[0]["as_of"].replace("Z", "+00:00"))
    from datetime import timezone
    predictions[0]["as_of"] = instant.astimezone(timezone(timedelta(hours=2))).isoformat()
    path.write_text(json.dumps(predictions))
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    before = snapshot_fingerprint(manifest)
    manifest["files"]["predictions.json"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    assert validate_snapshot(root)["dataset_version"] == manifest["dataset_version"]
    assert snapshot_fingerprint(manifest) != before


def test_forecast_percentage_inconsistent_with_tool_is_rejected(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    def model(*args, **kwargs):
        return {"message": {"content": json.dumps(dict(answer="Echo Division has a 99.99% win probability.",
            citation_ids=["predictions.json"], abstained=False))}}
    monkeypatch.setattr(agent, "_chat", model)
    result = agent.ask("Predict synthetic:valorant:000599")
    assert result["abstained"] and result["tool_results"][0]["rows"]
    agent.close()


def test_model_busy_queue_returns_429_without_generation(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    def model(*args, **kwargs):
        raise AssertionError("Busy model must not be invoked")
    monkeypatch.setattr(agent, "_chat", model)
    MODEL_LOCK.acquire()
    try:
        with TestClient(create_app(agent)) as client:
            result = client.post("/chat", json={"question": "Predict synthetic:valorant:000599"})
            assert result.status_code == 429
            assert result.headers["retry-after"] == "5"
    finally:
        MODEL_LOCK.release()


def test_precise_cited_forecast_is_accepted(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    def model(*args, **kwargs):
        return {"message": {"content": json.dumps(dict(
            answer="Zero Latitude: 33.71%; Echo Division: 66.29%. Synthetic and uncalibrated.",
            citation_ids=["predictions.json"], abstained=False))}}
    monkeypatch.setattr(agent, "_chat", model)
    response = agent.ask("Predict synthetic:valorant:000599")
    assert not response["abstained"]
    assert response["citations"][0]["id"] == "predictions.json"
    agent.close()


def test_graph_checkpoint_survives_new_agent_instance(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    response = agent.ask("Show VALORANT team win rates", mode="evidence")
    config = {"configurable": {"thread_id": response["trace_id"]}}
    agent.close()
    restarted = Copilot(default_fixture(), tmp_path)
    state = restarted.graph.get_state(config)
    assert state.values["question"] == "Show VALORANT team win rates"
    assert state.values["answer"] == response["answer"] and not state.next
    restarted.close()
