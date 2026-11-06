"""App-level current-data routes over original test-only provider fixtures."""

import pytest
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot, MODEL_LOCK
from arena_copilot.api import create_app
from arena_copilot.live import LiveRegistry
from arena_copilot.snapshot import default_fixture
from test_live import NOW, match, publish, status


@pytest.fixture
def client(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    row = match(match_id="football-data:123", team_a_id="football-data:3", team_b_id="football-data:4")
    publication = publish(workspace, rows=[row])
    status(workspace, snapshot=publication)
    registry = LiveRegistry(workspace, clock=lambda: NOW)
    model = Copilot(default_fixture(), tmp_path / "state")

    def no_model(*args, **kwargs):
        raise AssertionError("This integration check must not perform inference")

    monkeypatch.setattr(model, "_chat", no_model)
    with TestClient(create_app(model, live=registry)) as connection:
        yield connection


@pytest.mark.parametrize("prefix", ["", "/api"])
def test_app_routes_keep_captured_evidence_and_feedback_scoped(client, prefix):
    response = client.post(prefix + "/live/chat", json=dict(provider="football-data",
        question="Inspect this recorded result", mode="evidence", match_id="football-data:123"))
    assert response.status_code == 200
    value = response.json()
    assert value["provider"] == "football-data" and value["data_kind"] == "api"
    assert value["model"] is None and not value["abstained"]
    assert all(item["provider"] == "football-data" and item["snapshot_fingerprint"] == value["snapshot_fingerprint"]
               for item in value["citations"] + value["tool_results"])
    body = dict(provider="football-data", trace_id=value["trace_id"], rating=1,
                snapshot_fingerprint=value["snapshot_fingerprint"])
    assert client.post(prefix + "/live/feedback", json=body).status_code == 200
    assert client.post(prefix + "/live/feedback", json=dict(body, provider="pandascore")).status_code == 404
    assert client.post(prefix + "/live/chat", json=dict(provider="pandascore", question="Inspect", mode="evidence",
                                                        match_id="football-data:123")).status_code == 422
    assert client.post(prefix + "/live/chat", json=dict(provider="football-data", question="Inspect", mode="evidence",
                                                        sql="DROP TABLE current_matches")).status_code == 422


def test_live_generation_respects_the_shared_model_slot(client):
    MODEL_LOCK.acquire()
    try:
        response = client.post("/api/live/chat", json=dict(provider="football-data", question="Explain the result",
                                                          match_id="football-data:123"))
        assert response.status_code == 429
    finally:
        MODEL_LOCK.release()
