"""Original tiny TEST ONLY API-labelled fixtures, never provider acquisition.

No requests, credentials, real team data, models, or public fixtures are used.
"""

import hashlib
import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from arena_copilot.live import LiveRegistry, create_live_router
import arena_copilot.live as live_module

NOW = datetime(2026, 10, 6, 14, tzinfo=timezone.utc)


def timestamp(value):
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def match(provider="football-data", ident="one", revision=1, **changes):
    # API-labelled solely to exercise the importer boundary. Original fixture
    # identifiers/names are explicitly test-only, not scraped/provider facts.
    row = dict(event_id=f"{provider}:test:{ident}:{revision}", match_id=f"{provider}:test:{ident}",
               provider=provider, sport="football" if provider == "football-data" else "valorant",
               competition="TEST ONLY Original Competition", revision=revision,
               team_a_id=f"{provider}:test:a", team_a="TEST ONLY Maple",
               team_b_id=f"{provider}:test:b", team_b="TEST ONLY Pine",
               start_time=timestamp(NOW-timedelta(days=1)), observed_at=timestamp(NOW-timedelta(hours=1)),
               completed_at=timestamp(NOW-timedelta(hours=3)), status="finished", score_a=2, score_b=1,
               best_of=1 if provider == "football-data" else 3)
    row.update(changes)
    return row


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def publish(base, provider="football-data", rows=None, *, manifest_changes=None):
    rows = rows or [match(provider)]
    version = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()[:16]
    directory = base / provider / "snapshots" / f"snapshot-{version}-00000001"
    directory.mkdir(parents=True)
    for name, payload in {
        "catalog.json": [], "metrics.json": {}, "lineage.json": [],
        "quality.json": {"summary": {"valid_events": len(rows), "quarantined": 0}},
        "incidents.json": [], "predictions.json": [],
        "model_report.json": {"status": "unavailable", "data_kind": "api", "test_only": True},
    }.items():
        write_json(directory / name, payload)
    (directory / "docs").mkdir()
    (directory / "docs/test-only.md").write_text(
        "Original simulated API-labelled test fixture. No actual provider data was acquired.", encoding="utf-8")
    (directory / "gold").mkdir()
    pq.write_table(pa.Table.from_pylist(rows), directory / "gold/matches.parquet")
    schema = pa.schema([(key, pa.int64() if key in {"matches", "wins", "draws", "losses"}
                         else pa.float64() if key == "win_rate" else pa.string())
                        for key in ["sport", "team_id", "team_name", "matches", "wins", "draws", "losses", "win_rate"]])
    pq.write_table(pa.Table.from_pylist([], schema=schema), directory / "gold/team_stats.parquet")
    manifest = dict(schema_version="2.0", dataset_version=version, producer_version="test-only",
                    generated_at=timestamp(NOW-timedelta(minutes=2)), as_of=max(r["observed_at"] for r in rows),
                    data_kind="api", providers=[provider], files={
                        p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in directory.rglob("*") if p.is_file()
                    })
    manifest.update(manifest_changes or {})
    write_json(directory / "manifest.json", manifest)
    return directory


def status(base, provider="football-data", snapshot=None, **changes):
    payload = dict(schema_version="arena-live-status-1.0", provider=provider, data_kind="api",
                   status="ready" if snapshot else "awaiting_credentials",
                   last_attempt_at=timestamp(NOW-timedelta(seconds=20)) if snapshot else None,
                   last_success_at=timestamp(NOW-timedelta(seconds=10)) if snapshot else None,
                   last_change_at=timestamp(NOW-timedelta(minutes=1)) if snapshot else None,
                   poll_interval_seconds=60, last_error_code=None if snapshot else "awaiting_credentials",
                   latest_snapshot=snapshot.name if snapshot else None,
                   poll_counts=dict(attempted=1 if snapshot else 0, succeeded=1 if snapshot else 0,
                                    failed=0, awaiting_credentials=0 if snapshot else 1, quota_limited=0, interrupted=0),
                   last_poll=dict(source_rows=1 if snapshot else 0, changed_rows=1 if snapshot else 0,
                                  unsupported_rows=0, requests=1 if snapshot else 0),
                   capabilities=dict(tier="free", update_mode="polled_rest",
                                     scores_delayed=True if provider == "football-data" else None,
                                     fixtures_and_results=True, in_game_round_feed=False),
                   request_budget=dict(limit=10 if provider == "football-data" else 1000,
                                       window_seconds=60 if provider == "football-data" else 3600,
                                       used=1 if snapshot else 0,
                                       remaining=(10 if provider == "football-data" else 1000)-(1 if snapshot else 0)))
    payload.update(changes)
    destination = base / provider / "snapshots/LIVE_STATUS.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Mimic the producer's single atomic pointer/status publication.
    temporary = destination.with_suffix(".tmp")
    write_json(temporary, payload)
    temporary.replace(destination)
    return payload


def client(registry):
    app = FastAPI()
    app.include_router(create_live_router(registry))
    return TestClient(app)


def test_hot_reload_versions_replay_health_and_request_immutability(tmp_path):
    first = publish(tmp_path)
    status(tmp_path, snapshot=first)
    clock = [NOW]
    registry = LiveRegistry(tmp_path, clock=lambda: clock[0])
    with client(registry) as api:
        old = api.get("/live/matches", params={"provider": "football-data"}).json()
        assert old["status"] == "ready" and old["rows"][0]["score_a"] == 2
        captured_before_update = registry.capture("football-data")
        clock[0] += timedelta(minutes=1)
        status(tmp_path, snapshot=first, last_success_at=timestamp(clock[0]),
               last_attempt_at=timestamp(clock[0]-timedelta(seconds=1)),
               last_poll=dict(source_rows=1, changed_rows=0, unsupported_rows=0, requests=1))
        replay = api.get("/live/matches", params={"provider": "football-data"}).json()
        assert replay["dataset_version"] == old["dataset_version"]
        assert replay["snapshot_fingerprint"] == old["snapshot_fingerprint"]
        assert replay["cutoff"] == old["cutoff"] == timestamp(NOW-timedelta(hours=1))
        assert replay["poll_age_seconds"] == 0
        assert replay["last_poll"]["changed_rows"] == 0
        assert replay["rows"][0]["status"] == "finished"  # A fresh poll never invents IN_PLAY.
        second = publish(tmp_path, rows=[match(revision=2, score_a=4)])
        status(tmp_path, snapshot=second, last_success_at=timestamp(clock[0]))
        current = api.get("/live/matches", params={"provider": "football-data"}).json()
        assert current["dataset_version"] != old["dataset_version"]
        assert current["snapshot_fingerprint"] != old["snapshot_fingerprint"]
        assert current["rows"][0]["score_a"] == 4
        assert captured_before_update.dataset.by_id["football-data:test:one"].score_a == 2
        assert captured_before_update.dataset.fingerprint == old["snapshot_fingerprint"]
        # The established pointer queries memory, not mutable source Parquet.
        (second / "gold/matches.parquet").write_bytes(b"tampered after validated import")
        degraded = api.get("/live/matches", params={"provider": "football-data"}).json()
        assert degraded["status"] == "invalid_publication" and degraded["serving_last_good"]
        assert degraded["rows"][0]["score_a"] == 4
        assert degraded["snapshot_fingerprint"] == current["snapshot_fingerprint"]
        assert degraded["stale"]
    registry.close()


def test_capture_samples_clock_after_status_read_without_accepting_actual_future_clocks(tmp_path, monkeypatch):
    first = publish(tmp_path)
    status(tmp_path, snapshot=first)
    clock = [NOW]
    registry = LiveRegistry(tmp_path, clock=lambda: clock[0])
    before = registry.capture("football-data")
    read_started, resume_read = threading.Event(), threading.Event()
    original_read, captures = live_module._read, []

    def synchronized_read(path, limit):
        if path.name == "LIVE_STATUS.json":
            read_started.set()
            assert resume_read.wait(timeout=10), "Test did not release the bounded status read"
        return original_read(path, limit)

    monkeypatch.setattr(live_module, "_read", synchronized_read)
    worker = threading.Thread(target=lambda: captures.append(registry.capture("football-data")), daemon=True)
    worker.start()
    try:
        assert read_started.wait(timeout=10), "Capture did not reach its status read"
        clock[0] += timedelta(seconds=30)
        status(tmp_path, snapshot=first, last_attempt_at=timestamp(clock[0]-timedelta(seconds=1)),
               last_success_at=timestamp(clock[0]), last_change_at=timestamp(clock[0]))
    finally:
        resume_read.set()
        worker.join(timeout=10)
    assert not worker.is_alive() and len(captures) == 1
    after = captures[0]
    assert after.state == "ready" and after.now == clock[0]
    assert after.status.last_success_at == timestamp(clock[0])
    assert after.dataset.fingerprint == before.dataset.fingerprint
    assert registry._envelope(after)["poll_age_seconds"] == 0
    # A real source timestamp after the post-read clock remains forbidden.
    status(tmp_path, snapshot=first, last_success_at=timestamp(clock[0]+timedelta(seconds=1)))
    future = registry.capture("football-data")
    assert future.state == "invalid_publication" and future.error == "future_timestamp"
    assert future.dataset.fingerprint == before.dataset.fingerprint and future.serving_last_good
    registry.close()


def test_provider_isolation_pending_empty_and_unavailable_detail(tmp_path):
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    with client(registry) as api:
        health = api.get("/live/health").json()
        assert {p["status"] for p in health["providers"]} == {"not_connected"}
        status(tmp_path)
        waiting = api.get("/live/matches", params={"provider": "football-data"}).json()
        assert waiting["status"] == "awaiting_credentials" and waiting["rows"] == []
        assert waiting["dataset_version"] is None and not waiting["snapshot_available"]
        assert api.get("/live/matches/no-match", params={"provider": "football-data"}).status_code == 503
        status(tmp_path, status="empty", last_success_at=timestamp(NOW))
        assert api.get("/live/matches", params={"provider": "football-data"}).json()["status"] == "empty"
        football = publish(tmp_path)
        valorant = publish(tmp_path, "pandascore")
        status(tmp_path, snapshot=football)
        status(tmp_path, "pandascore", valorant)
        for provider, sport in [("football-data", "football"), ("pandascore", "valorant")]:
            body = api.get("/live/matches", params={"provider": provider}).json()
            assert body["provider"] == provider and body["rows"][0]["sport"] == sport
            assert body["data_kind"] == "api" and body["predictions_available"] is False
        wrong = api.get("/live/matches/football-data:test:one", params={"provider": "pandascore"})
        assert wrong.status_code == 404 and wrong.json()["provider"] == "pandascore"
        update = api.get("/live/updates").json()
        assert set(update["revision_vector"]) == {"football-data", "pandascore"}
        assert update["transport"] == "client_polling" and update["in_game_round_feed"] is False
        assert api.get("/live/matches").status_code == 422
        assert api.get("/live/matches", params={"provider": "synthetic"}).status_code == 422


def test_degraded_quota_and_expired_poll_keep_version_and_distinguish_age(tmp_path):
    snapshot = publish(tmp_path)
    status(tmp_path, snapshot=snapshot)
    clock = [NOW]
    registry = LiveRegistry(tmp_path, clock=lambda: clock[0])
    before = registry.matches("football-data")
    status(tmp_path, snapshot=snapshot, status="degraded", last_error_code="network_timeout")
    failed = registry.matches("football-data")
    assert failed["status"] == "degraded" and failed["serving_last_good"]
    assert failed["last_error_code"] == "network_timeout"
    assert failed["dataset_version"] == before["dataset_version"] and failed["rows"] == before["rows"]
    status(tmp_path, snapshot=snapshot, status="quota_limited", last_error_code="quota_exhausted")
    assert registry.provider_health("football-data")["status"] == "quota_limited"
    clock[0] += timedelta(minutes=5)
    status(tmp_path, snapshot=snapshot)
    stale = registry.provider_health("football-data")
    assert stale["status"] == "stale" and stale["poll_age_seconds"] == 310
    assert stale["cutoff"] == timestamp(NOW-timedelta(hours=1))
    (tmp_path / "football-data/snapshots/LIVE_STATUS.json").unlink()
    missing = registry.matches("football-data")
    assert missing["status"] == "not_connected" and missing["serving_last_good"]
    assert missing["rows"] == before["rows"]


@pytest.mark.parametrize("bad", [
    {"latest_snapshot": "../private"},
    {"latest_snapshot": "C:\\secret"},
    {"last_success_at": ""},
    {"last_success_at": "2026-10-06T14:00:01Z"},
    {"last_success_at": "2026-10-06T14:00:00"},
    {"poll_counts": dict(attempted=True, succeeded=1, failed=0, awaiting_credentials=0,
                         quota_limited=0, interrupted=0)},
    {"last_error_code": "PRIVATE_TEST_TOKEN_DO_NOT_EXPOSE"},
    {"unexpected_token": "PRIVATE_TEST_TOKEN_DO_NOT_EXPOSE"},
])
def test_bad_status_retains_last_good_and_never_exposes_source_values(tmp_path, bad):
    snapshot = publish(tmp_path)
    status(tmp_path, snapshot=snapshot)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    before = registry.matches("football-data")
    status(tmp_path, snapshot=snapshot, **bad)
    after = registry.matches("football-data")
    assert after["status"] == "invalid_publication" and after["serving_last_good"]
    assert after["rows"] == before["rows"] and after["dataset_version"] == before["dataset_version"]
    assert "PRIVATE_TEST_TOKEN" not in json.dumps(after)


@pytest.mark.parametrize("change", [
    {"data_kind": "synthetic", "providers": ["synthetic"]},
    {"providers": ["football-data", "pandascore"]},
    {"generated_at": "2026-10-06T14:01:00Z"},
    {"as_of": "2026-10-06T14:01:00Z", "generated_at": "2026-10-06T14:02:00Z"},
])
def test_invalid_candidate_provenance_or_publication_clock_cannot_replace_dataset(tmp_path, change):
    first = publish(tmp_path)
    status(tmp_path, snapshot=first)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    original = registry.matches("football-data")
    bad = publish(tmp_path, rows=[match(revision=2)], manifest_changes=change)
    status(tmp_path, snapshot=bad)
    after = registry.matches("football-data")
    assert after["status"] == "invalid_publication"
    assert after["snapshot_fingerprint"] == original["snapshot_fingerprint"]
    assert after["rows"] == original["rows"]


def test_missing_snapshot_and_oversized_status_are_explicit_invalid_publications(tmp_path):
    first = publish(tmp_path)
    status(tmp_path, snapshot=first)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    before = registry.matches("football-data")
    status(tmp_path, snapshot=Path("snapshot-1111111111111111-00000001"))
    absent = registry.matches("football-data")
    assert absent["status"] == "invalid_publication" and absent["publication_error_code"] == "snapshot_missing"
    path = tmp_path / "football-data/snapshots/LIVE_STATUS.json"
    path.write_bytes(b" " * 65537)
    assert registry.matches("football-data")["rows"] == before["rows"]
    assert registry.provider_health("football-data")["status"] == "invalid_publication"


def test_typed_rows_and_future_availability_are_rejected_but_upcoming_kickoff_is_allowed(tmp_path):
    upcoming = match(status="scheduled", completed_at=None, score_a=None, score_b=None,
                     start_time=timestamp(NOW+timedelta(days=4)))
    valid = publish(tmp_path, rows=[upcoming])
    status(tmp_path, snapshot=valid)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    assert registry.matches("football-data")["rows"][0]["status"] == "scheduled"
    wrong_type = publish(tmp_path, rows=[match(revision=2, score_a=2.0)])
    status(tmp_path, snapshot=wrong_type)
    assert registry.matches("football-data")["status"] == "invalid_publication"
    wrong_clock = publish(tmp_path, rows=[match(revision=3, observed_at=timestamp(NOW+timedelta(days=1)))])
    status(tmp_path, snapshot=wrong_clock)
    assert registry.matches("football-data")["status"] == "invalid_publication"
    assert registry.matches("football-data")["rows"][0]["status"] == "scheduled"


def test_combined_filters_before_pagination_and_literal_search_have_bounded_scope(tmp_path):
    dataset = publish(tmp_path, rows=[
        match(ident="one", start_time="2026-10-04T23:30:00-02:00", completed_at="2026-10-05T06:00:00Z"),
        match(ident="two", competition="TEST ONLY Other", start_time="2026-10-04T01:00:00Z"),
        match(ident="three", status="scheduled", completed_at=None, score_a=None, score_b=None,
              start_time="2026-10-08T01:00:00Z", team_a_id="football-data:test:c", team_a="TEST ONLY Cedar"),
    ])
    status(tmp_path, snapshot=dataset)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    with client(registry) as api:
        params = dict(provider="football-data", competition="TEST ONLY Original Competition", status="finished",
                      team_id="football-data:test:a", search="mApLe", date_from="2026-10-05", date_to="2026-10-05", limit=1)
        response = api.get("/live/matches", params=params).json()
        assert response["total"] == 1 and len(response["rows"]) == 1
        assert response["rows"][0]["match_id"] == "football-data:test:one"
        assert response["rows"][0]["start_time"] == "2026-10-05T01:30:00.000000Z"
        assert api.get("/live/matches", params=dict(params, offset=1)).json()["rows"] == []
        assert api.get("/live/matches", params=dict(provider="football-data", search="' OR 1=1 --")).json()["total"] == 0
        page = api.get("/live/matches", params=dict(provider="football-data", order="asc", limit=1, offset=1)).json()
        assert page["total"] == 3 and page["rows"][0]["match_id"] == "football-data:test:one"
        assert api.get("/live/matches", params=dict(provider="football-data", limit=101)).status_code == 422
        assert api.get("/live/matches", params=dict(provider="football-data", offset=100001)).status_code == 422
        assert api.get("/live/matches", params=dict(provider="football-data", date_from="2026-10-06", date_to="2026-10-05")).status_code == 400
        assert api.get("/live/matches", params=dict(provider="football-data", date_to="9999-12-31")).status_code == 400


def test_known_poll_scope_and_legacy_unknown_scope_are_distinct(tmp_path):
    dataset = publish(tmp_path)
    status(tmp_path, snapshot=dataset)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    assert registry.provider_health("football-data")["freshness_scope"] == "unknown_poll_scope"
    scope = dict(kind="competition_list", competition_codes=["PL", "PD", "BL1", "SA", "FL1", "BSA"], phases=[], pages=1)
    status(tmp_path, snapshot=dataset, source_scope=scope)
    known = registry.provider_health("football-data")
    assert known["freshness_scope"] == "declared_poll_scope" and known["source_scope"] == scope
    expanded = dict(scope, competition_codes=["PL", "PD", "BL1", "SA", "FL1", "BSA", "WC", "CL", "EC", "DED"])
    status(tmp_path, snapshot=dataset, source_scope=expanded)
    assert registry.provider_health("football-data")["source_scope"] == expanded
    for invalid in (["WC/../../"], ["CL\n"], ["Ligue\u00e9"], ["A"]*11):
        status(tmp_path, snapshot=dataset, source_scope=dict(scope, competition_codes=invalid))
        assert registry.provider_health("football-data")["status"] == "invalid_publication"
    status(tmp_path, snapshot=dataset, source_scope=dict(scope, competition_codes=["PL", "PL"]))
    assert registry.provider_health("football-data")["status"] == "invalid_publication"


def test_selected_lower_request_budget_matches_the_producer_contract(tmp_path):
    dataset = publish(tmp_path)
    status(tmp_path, snapshot=dataset, request_budget=dict(limit=3, window_seconds=60, used=1, remaining=2))
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    health = registry.provider_health("football-data")
    assert health["status"] == "ready" and health["request_budget"] == dict(limit=3, window_seconds=60, used=1, remaining=2)
    for invalid in (dict(limit=11, window_seconds=60, used=1, remaining=10),
                    dict(limit=3, window_seconds=3600, used=1, remaining=2),
                    dict(limit=3, window_seconds=60, used=1, remaining=3)):
        status(tmp_path, snapshot=dataset, request_budget=invalid)
        assert registry.provider_health("football-data")["status"] == "invalid_publication"


def test_symlink_publications_are_never_followed(tmp_path):
    dataset = publish(tmp_path)
    status(tmp_path, snapshot=dataset)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    original = registry.matches("football-data")
    source = dataset / "gold/matches.parquet"
    parked = tmp_path / "parked.parquet"
    source.replace(parked)
    try:
        source.symlink_to(parked)
    except OSError:
        pytest.skip("This Windows account cannot create symbolic links")
    broken = registry.matches("football-data")
    assert broken["status"] == "invalid_publication" and broken["publication_error_code"] == "unsafe_path"
    assert broken["rows"] == original["rows"]
