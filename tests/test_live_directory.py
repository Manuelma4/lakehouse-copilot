"""Original test-only announcements; no acquisition, credentials or inference."""

import copy
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from arena_copilot.api import create_app
from arena_copilot.live import LiveRegistry
from arena_copilot.live_publication import (
    DisplayError, _canonical, _fingerprint, _hash, export_live_display,
    local_display_envelope, validate_display_bytes, validate_live_display,
)
from test_current_publication import business, calendar, paired_status, select
from test_live import NOW, match, publish, status, timestamp

SCHEMA = "arena-live-display-2.0"


def paired(base, rows, *, canonical_rows=None, links=(), poll_id=1):
    snapshot = publish(base, "pandascore", canonical_rows) if canonical_rows else None
    package = calendar(base, rows, links=links)
    selector = select(base, package, snapshot, poll_id=poll_id)
    paired_status(base, snapshot)
    return selector


def directory(base, output, *, clock=NOW, limit=500, previous=None):
    registry = LiveRegistry(base, clock=lambda: clock)
    try:
        export_live_display(registry, output, now=clock, limit=limit, previous=previous, schema_version=SCHEMA)
    finally:
        registry.close()
    return validate_live_display(output, now=clock)


def undated(identity=7, source_text=None):
    row = business(identity)
    row["start_time"] = None
    row["source_dates"]["begin_at"] = source_text
    reasons = ["unresolved_opponents", "unresolved_start_time"]
    if source_text and "T" in source_text:
        reasons.append("start_time_timezone_unknown")
    row["pending_reasons"] = sorted(reasons)
    return row


def resolved(identity=7, *, finished=False, scores=(0, 0), best_of=3):
    row = business(identity, resolved=True)
    if finished:
        row["source_status"] = "finished"
        row["start_time"] = timestamp(NOW-timedelta(days=1))
        row["source_dates"]["begin_at"] = row["start_time"]
    row["source_number_of_games"] = best_of
    row["source_results"] = [dict(team_id=f"pandascore:{ident}", source_team_id=ident, score=score)
                              for ident, score in zip((1, 2), scores, strict=True)]
    row["result_known"] = finished
    return row


def canonical_row(row):
    return match("pandascore", match_id=row["announcement_id"],
        team_a_id="pandascore:1", team_b_id="pandascore:2",
        team_a="TEST ONLY Maple", team_b="TEST ONLY Pine", start_time=row["start_time"],
        status="finished" if row["source_status"] == "finished" else "scheduled",
        score_a=row["source_results"][0]["score"], score_b=row["source_results"][1]["score"],
        completed_at=timestamp(NOW-timedelta(hours=3)) if row["source_status"] == "finished" else None,
        best_of=row["source_number_of_games"])


def reseal(package, mutate):
    from arena_copilot.live_directory import facts
    values = copy.deepcopy(package)
    payload = values["providers"]["pandascore"]
    mutate(payload)
    payload["facts_version"] = _hash(_canonical(facts(payload)))[:16]
    manifest = values["manifest"]
    bodies = {provider: _canonical(body)+b"\n" for provider, body in values["providers"].items()}
    manifest["files"] = {f"{provider}.json": _hash(raw) for provider, raw in bodies.items()}
    manifest["facts_versions"] = {provider: body["facts_version"] for provider, body in values["providers"].items()}
    manifest["display_version"] = _hash(_canonical(values["providers"]))[:16]
    manifest["package_fingerprint"] = _fingerprint(manifest["display_version"], manifest["files"], SCHEMA)
    return _canonical(manifest)+b"\n", bodies


def test_calendar_only_pending_cards_distinct_events_and_success_clock(tmp_path):
    rows = [business(7, tournament_id=80), business(8, tournament_id=81), undated(9)]
    selector = paired(tmp_path/"private", rows)
    result = directory(tmp_path/"private", tmp_path/"display", limit=2)
    payload = result["providers"]["pandascore"]
    assert result["manifest"]["schema_version"] == SCHEMA
    assert payload["canonical"] is None and payload["calendar"] is not None
    assert payload["publication"]["fingerprint"] == selector["fingerprint"]
    assert payload["health"]["last_success_at"] == selector["collected_at"]
    assert payload["health"]["last_change_at"] is None and not payload["health"]["stale"]
    assert payload["directory_status"] == "observed"
    coverage = payload["coverage"]
    assert (coverage["retained_total"], coverage["window_total"], coverage["unknown_utc_total"],
            coverage["eligible_total"], coverage["displayed"], coverage["clipped"]) == (3, 2, 1, 3, 2, 1)
    assert coverage["pending_total"] == 3 and coverage["pending_displayed"] == 2
    cards = payload["cards"]
    assert all(card["team_a"] is None and card["team_b"] is None for card in cards)
    assert all(card["result_state"] == "unavailable" for card in cards)
    nodes = payload["directory_nodes"]
    assert len(nodes) == 2 and nodes[0]["label"] == nodes[1]["label"] == "TEST ONLY Playoffs"
    assert nodes[0]["display_id"] != nodes[1]["display_id"]
    raw = b"".join(path.read_bytes() for path in (tmp_path/"display").iterdir())
    assert b"pandascore:7" not in raw and b'"source_id":' not in raw and b'"archive_sha256":' not in raw


@pytest.mark.parametrize("stamp", ["2026-10-06T13:58:00+00:00", "2026-10-06T15:58:00+02:00"])
def test_canonical_source_clock_normalized_without_changing_package_identity(tmp_path, stamp):
    base = tmp_path/"private"
    snapshot = publish(base, manifest_changes={"generated_at": stamp})
    status(base, snapshot=snapshot)
    registry = LiveRegistry(base, clock=lambda: NOW)
    try:
        identity = registry.capture("football-data").dataset.fingerprint
        envelope = local_display_envelope(registry, now=NOW)
        body = json.loads(envelope["provider_json"]["football-data"])
        assert body["canonical"]["generated_at"] == "2026-10-06T13:58:00.000000Z"
        assert body["canonical"]["snapshot_fingerprint"] == identity
        assert json.loads((snapshot/"manifest.json").read_text())["generated_at"] == stamp
    finally:
        registry.close()


@pytest.mark.parametrize("text,precision", [(None, "unknown"), ("2026-10-09", "source_date"),
                                           ("2026-10-09T14:00:00", "timezone_unknown")])
def test_source_clock_never_becomes_invented_utc(tmp_path, text, precision):
    paired(tmp_path/"private", [undated(source_text=text)])
    payload = directory(tmp_path/"private", tmp_path/"display")["providers"]["pandascore"]
    card = payload["cards"][0]
    assert card["kickoff_precision"] == precision and card["kickoff_source_text"] == text
    assert card["kickoff_utc"] is None and card["day_utc"] is None and card["kickoff_label"] is None
    assert payload["coverage"]["eligible_undated_total"] == 1


def test_pending_identity_resolves_and_enables_only_same_capture_record_link(tmp_path, monkeypatch):
    base = tmp_path/"private"
    paired(base, [business()])
    old = directory(base, tmp_path/"before")["providers"]["pandascore"]["cards"][0]
    row = resolved()
    paired(base, [row], canonical_rows=[canonical_row(row)], links=[row["announcement_id"]], poll_id=2)
    registry = LiveRegistry(base, clock=lambda: NOW)
    calls, original = [], registry.capture
    monkeypatch.setattr(registry, "capture", lambda provider: (calls.append(provider), original(provider))[1])
    envelope = local_display_envelope(registry, now=NOW)
    assert calls == ["football-data", "pandascore"]
    checked = validate_display_bytes(envelope["manifest_json"].encode(),
        {provider: body.encode() for provider, body in envelope["provider_json"].items()}, now=NOW)
    payload = checked["providers"]["pandascore"]
    current = payload["cards"][0]
    assert current["display_id"] == old["display_id"]
    assert current["resolution"] == "validated" and current["association_state"] == "matches_latest_announcement"
    assert current["score_label"] is None  # A scheduled 0–0 is not a played result.
    assert envelope["canonical_links"]["pandascore"] == {current["display_id"]: {
        "match_id": row["announcement_id"], "snapshot_fingerprint": payload["canonical"]["snapshot_fingerprint"]}}
    assert set(envelope) == {"manifest_json", "provider_json", "canonical_links", "captured_at"}
    registry.close()


def test_historical_association_never_fills_current_fields_or_enables_tools(tmp_path):
    latest, retained = resolved(), resolved(finished=True, scores=(2, 1))
    paired(tmp_path/"private", [latest], canonical_rows=[canonical_row(retained)], links=[latest["announcement_id"]])
    registry = LiveRegistry(tmp_path/"private", clock=lambda: NOW)
    envelope = local_display_envelope(registry, now=NOW)
    payload = json.loads(envelope["provider_json"]["pandascore"])
    card = payload["cards"][0]
    assert card["association_state"] == "associated_historical" and card["status_label"] == "Scheduled"
    assert card["kickoff_utc"] == latest["start_time"] and card["score_label"] is None
    assert not envelope["canonical_links"]["pandascore"]
    registry.close()


def test_source_reported_large_scores_are_distinct_from_validated_final(tmp_path):
    paired(tmp_path/"private", [resolved(finished=True, scores=(1000, 999), best_of=101)])
    payload = directory(tmp_path/"private", tmp_path/"display")["providers"]["pandascore"]
    card = payload["cards"][0]
    assert card["series_format"] == "Best of 101" and card["score_label"] == "1000–999"
    assert card["result_state"] == "source_reported" and card["winning_side"] is None


def test_canonical_only_football_has_observed_labels_without_invented_season(tmp_path):
    base = tmp_path/"private"
    snapshot = publish(base)
    status(base, snapshot=snapshot)
    payload = directory(base, tmp_path/"display")["providers"]["football-data"]
    assert payload["calendar"] is None and payload["publication"] is None
    assert payload["directory_status"] == "observed"
    assert payload["cards"][0]["resolution"] == "validated"
    assert payload["cards"][0]["result_state"] == "final"
    node, = payload["directory_nodes"]
    assert node["identity_basis"] == "observed_label" and node["kind"] == "competition"
    assert node["season"] is None and node["year"] is None and node["parent_id"] is None


def test_observed_metadata_and_parent_conflicts_are_visible_without_guessed_hierarchy(tmp_path):
    first, second = business(7), business(8)
    for row, source_id in ((first, 10), (second, 11)):
        row["series"] = dict(row["tournament"], id=f"pandascore:series:{source_id}", source_id=source_id,
                             name="TEST ONLY Stage")
    second["tournament"]["name"] = "TEST ONLY Different source label"
    paired(tmp_path/"private", [first, second])
    payload = directory(tmp_path/"private", tmp_path/"display")["providers"]["pandascore"]
    tournament, = [node for node in payload["directory_nodes"] if node["kind"] == "tournament"]
    assert tournament["metadata_conflicted"] and tournament["parent_conflicted"]
    assert tournament["name"] is None and tournament["parent_id"] is None
    assert len([node for node in payload["directory_nodes"] if node["kind"] == "series"]) == 2


def test_poll_clocks_change_evidence_fingerprints_without_changing_business_facts(tmp_path):
    base = tmp_path/"private"
    paired(base, [business()])
    old = directory(base, tmp_path/"first")["providers"]["pandascore"]
    package = calendar(base, [business()], observed=NOW-timedelta(seconds=30))
    select(base, package, poll_id=2, collected=NOW-timedelta(seconds=25), selected=NOW-timedelta(seconds=15))
    paired_status(base)
    current = directory(base, tmp_path/"second")["providers"]["pandascore"]
    assert current["facts_version"] == old["facts_version"] and current["cards"] == old["cards"]
    assert current["calendar"]["calendar_fingerprint"] != old["calendar"]["calendar_fingerprint"]
    assert current["publication"]["fingerprint"] != old["publication"]["fingerprint"]


@pytest.mark.parametrize("mutation", [
    lambda p: p["cards"][0].update(day_utc="2026-10-09"),
    lambda p: p["cards"][0].update(result_state="final", score_label="2–1", winning_side="team_a"),
    lambda p: p["directory_nodes"][0].update(parent_id=p["directory_nodes"][0]["display_id"]),
    lambda p: p["directory_nodes"][0].update(source_id=80),
    lambda p: p["coverage"].update(unknown_utc_total=99),
    lambda p: p["health"].update(last_success_at=timestamp(NOW-timedelta(seconds=10))),
    lambda p: p["health"].update(last_change_at=timestamp(NOW-timedelta(seconds=60))),
    lambda p: p["publication"].update(selected_at=timestamp(NOW+timedelta(seconds=1))),
    lambda p: p["directory_nodes"].append(dict(p["directory_nodes"][0], display_id="pandascore-aaaaaaaaaaaaaaaa")),
])
def test_resealed_invalid_calendar_projection_is_rejected(tmp_path, mutation):
    paired(tmp_path/"private", [undated()])
    before = directory(tmp_path/"private", tmp_path/"display")
    manifest, bodies = reseal(before, mutation)
    with pytest.raises(DisplayError):
        validate_display_bytes(manifest, bodies, now=NOW)


def test_last_good_calendar_recovers_whole_pair_without_advancing_source_clocks(tmp_path):
    paired(tmp_path/"private", [undated()])
    before = directory(tmp_path/"private", tmp_path/"old")
    later = NOW+timedelta(days=1)
    after = directory(tmp_path/"missing", tmp_path/"recovered", clock=later, previous=tmp_path/"old")
    old, current = (value["providers"]["pandascore"] for value in (before, after))
    for field in ("canonical", "calendar", "publication", "cards", "coverage", "directory_nodes", "facts_version"):
        assert current[field] == old[field]
    assert current["health"]["last_success_at"] == old["health"]["last_success_at"]
    assert current["health"]["stale"] and current["health"]["serving_last_good"]


def test_explicit_v1_recovery_has_no_fabricated_calendar_or_directory(tmp_path):
    base = tmp_path/"private"
    snapshot = publish(base)
    status(base, snapshot=snapshot)
    registry = LiveRegistry(base, clock=lambda: NOW)
    export_live_display(registry, tmp_path/"v1", now=NOW)
    registry.close()
    recovered = directory(tmp_path/"missing", tmp_path/"v2", previous=tmp_path/"v1")["providers"]["football-data"]
    assert recovered["calendar"] is None and recovered["publication"] is None
    assert recovered["directory_status"] == "not_supplied" and recovered["directory_nodes"] == []
    assert recovered["cards"][0]["resolution"] == "legacy"
    assert recovered["cards"][0]["association_state"] == "canonical_record"
    assert recovered["cards"][0]["result_state"] == "final"


def test_local_display_endpoint_is_read_only_and_uses_one_capture_per_provider(tmp_path, monkeypatch):
    paired(tmp_path/"private", [business()])
    registry = LiveRegistry(tmp_path/"private", clock=lambda: NOW)
    calls, original = [], registry.capture
    monkeypatch.setattr(registry, "capture", lambda provider: (calls.append(provider), original(provider))[1])
    before = {path.relative_to(tmp_path): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    response = TestClient(create_app(live=registry)).get("/api/live/display")
    assert response.status_code == 200 and calls == ["football-data", "pandascore"]
    body = response.json()
    assert body["canonical_links"] == {"football-data": {}, "pandascore": {}}
    validate_display_bytes(body["manifest_json"].encode(),
        {provider: raw.encode() for provider, raw in body["provider_json"].items()})
    after = {path.relative_to(tmp_path): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    assert after == before
    registry.close()


def test_missing_status_keeps_verified_collection_and_uses_explicit_fallback_cadence(tmp_path):
    base = tmp_path/"private"
    selector = paired(base, [business()])
    (base/"pandascore/snapshots/LIVE_STATUS.json").unlink()
    payload = directory(base, tmp_path/"display")["providers"]["pandascore"]
    assert payload["health"]["last_success_at"] == selector["collected_at"]
    assert payload["health"]["poll_interval_seconds"] is None
    assert payload["health"]["stale_after_seconds"] == 120
    assert payload["health"]["last_change_at"] is None
    assert payload["cards"][0]["resolution"] == "pending" and not payload["health"]["stale"]


def test_local_links_exclude_private_test_ids_unsupported_by_chat_contract(tmp_path):
    base = tmp_path/"private"
    snapshot = publish(base)
    status(base, snapshot=snapshot)
    registry = LiveRegistry(base, clock=lambda: NOW)
    envelope = local_display_envelope(registry, now=NOW)
    assert json.loads(envelope["provider_json"]["football-data"])["cards"]
    assert envelope["canonical_links"]["football-data"] == {}
    registry.close()
