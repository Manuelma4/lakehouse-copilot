"""Original TEST ONLY fixtures; no licensed response bodies or provider calls."""

import copy
import hashlib
import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest

from arena_copilot.live import LiveRegistry
from arena_copilot.live_publication import DisplayError, export_live_display, validate_live_display
from test_live import NOW, match, publish, status, timestamp


def export(tmp_path, rows=None, provider="football-data", *, limit=500, clock=NOW, **status_changes):
    source = tmp_path / "private"
    snapshot = publish(source, provider, rows)
    status(source, provider, snapshot, **status_changes)
    registry = LiveRegistry(source, clock=lambda: clock)
    target = tmp_path / "display"
    manifest = export_live_display(registry, target, now=clock, limit=limit)
    return target, validate_live_display(target, now=clock), registry, source, manifest


def reseal(target, provider, mutation, *, update_facts=True):
    filename = target / f"{provider}.json"
    payload = json.loads(filename.read_text(encoding="utf-8"))
    mutation(payload)
    if update_facts:
        coverage = {key: value for key, value in payload["coverage"].items() if key not in ("unsupported_last_poll", "note")}
        facts = dict(provider=payload["provider"], cards=sorted(payload["cards"], key=lambda row: row["display_id"]), coverage=coverage)
        payload["facts_version"] = digest(facts)[:16]
    raw = canonical(payload) + b"\n"
    filename.write_bytes(raw)
    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"][filename.name] = hashlib.sha256(raw).hexdigest()
    manifest["facts_versions"][provider] = payload["facts_version"]
    payloads = {name: json.loads((target / f"{name}.json").read_text(encoding="utf-8"))
                for name in ("football-data", "pandascore")}
    manifest["display_version"] = digest(payloads)[:16]
    manifest["package_fingerprint"] = digest(dict(schema_version="arena-live-display-1.0",
        display_version=manifest["display_version"], files=manifest["files"]))
    manifest_path.write_bytes(canonical(manifest) + b"\n")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def test_one_capture_per_provider_processed_fields_and_exact_private_boundary(tmp_path, monkeypatch):
    source = tmp_path / "private"
    snapshot = publish(source)
    status(source, snapshot=snapshot)
    registry = LiveRegistry(source, clock=lambda: NOW)
    calls = []
    original = registry.capture
    def capture(provider):
        calls.append(provider)
        return original(provider)
    monkeypatch.setattr(registry, "capture", capture)
    target = tmp_path / "display"
    export_live_display(registry, target, now=NOW)
    assert calls == ["football-data", "pandascore"]
    payload = validate_live_display(target, now=NOW)
    card = payload["providers"]["football-data"]["cards"][0]
    assert card["status_label"] == "Finished" and card["score_label"] == "2–1"
    assert card["result_state"] == "final" and card["winning_side"] == "team_a"
    assert card["day_utc"] == "2026-10-05" and card["kickoff_label"] == "14:00 UTC"
    assert card["series_format"] == "Single match"
    assert payload["providers"]["football-data"]["canonical"]["dataset_version"] in snapshot.name
    assert {path.name for path in target.iterdir()} == {"manifest.json", "football-data.json", "pandascore.json"}
    combined = b"".join(path.read_bytes() for path in target.iterdir())
    for private in (b"event_id", b"revision", b"match_id", b"team_a_id", b"test:one", b"raw_archives", b"Authorization",
                    b"predictions.json", b"trace_id", b"probabilities", b"score_a", b"score_b"):
        assert private not in combined


def test_unavailable_is_explicit_with_attribution_and_no_fixture_fallback(tmp_path):
    registry = LiveRegistry(tmp_path / "absent", clock=lambda: NOW)
    export_live_display(registry, tmp_path / "display", now=NOW)
    payload = validate_live_display(tmp_path / "display", now=NOW)
    for provider in payload["providers"].values():
        assert provider["canonical"] is None and provider["cards"] == []
        assert provider["health"]["state"] == "not_connected" and provider["health"]["stale"]
        assert provider["coverage"]["retained_total"] == 0
    assert payload["providers"]["pandascore"]["attribution"]["text"] == "Source: PandaScore"
    assert payload["providers"]["football-data"]["attribution"]["text"] == "Football data provided by the Football-Data.org API"


def test_window_inclusive_calendar_days_running_exception_and_cap(tmp_path):
    dates = [("begin", -14, "finished"), ("before", -15, "finished"), ("through", 30, "scheduled"),
             ("after", 31, "scheduled"), ("running-old", -40, "running"), ("future", 2, "scheduled")]
    rows = []
    for ident, days, state in dates:
        kickoff = NOW + timedelta(days=days)
        rows.append(match(ident=ident, start_time=timestamp(kickoff), status=state,
                          completed_at=timestamp(kickoff + timedelta(hours=1)) if state == "finished" else None))
    _, payload, _, _, _ = export(tmp_path, rows, limit=2)
    p = payload["providers"]["football-data"]
    assert p["coverage"] | {} == dict(retained_total=6, window_total=4, displayed=2, clipped=2, outside_window=2,
        running_outside_window=1, unsupported_last_poll=0, card_limit=2, window_from="2026-09-22", window_through="2026-11-05",
        window_day_utc="2026-10-06",
        note=p["coverage"]["note"])
    assert [row["status_label"] for row in p["cards"]] == ["In progress", "Scheduled"]
    assert p["cards"][1]["day_utc"] == "2026-10-08"


@pytest.mark.parametrize("state,future,score_state", [("scheduled", True, "unavailable"),
    ("cancelled", False, "unavailable"), ("postponed", False, "unavailable"),
    ("running", True, "unavailable"), ("running", False, "provisional")])
def test_source_scores_are_hidden_for_unconfirmed_statuses_and_future_running(tmp_path, state, future, score_state):
    kickoff = NOW + timedelta(days=1 if future else -1)
    row = match(start_time=timestamp(kickoff), status=state, completed_at=None, score_a=3, score_b=1)
    _, payload, _, _, _ = export(tmp_path, [row])
    card = payload["providers"]["football-data"]["cards"][0]
    assert card["result_state"] == score_state and card["winning_side"] is None
    assert card["score_label"] == ("3–1" if score_state == "provisional" else None)


def test_valorant_format_final_result_and_no_round_claim(tmp_path):
    _, payload, _, _, _ = export(tmp_path, [match("pandascore")], provider="pandascore")
    p = payload["providers"]["pandascore"]
    assert p["cards"][0]["series_format"] == "Best of 3"
    assert p["cards"][0]["score_label"] == "2–1" and p["cards"][0]["result_state"] == "final"
    assert p["health"]["scores_delayed"] is None and not p["health"]["in_game_round_feed"]


def test_unchanged_poll_preserves_facts_version_and_refreshes_display_version(tmp_path):
    first, payload, registry, source, before = export(tmp_path)
    snapshot = source / "football-data" / "snapshots" / next((source / "football-data/snapshots").glob("snapshot-*" )).name
    later = NOW + timedelta(seconds=60)
    status(source, snapshot=snapshot, last_attempt_at=timestamp(later - timedelta(seconds=1)),
           last_success_at=timestamp(later), last_poll=dict(source_rows=1, changed_rows=0, unsupported_rows=0, requests=1))
    registry.clock = lambda: later
    after = export_live_display(registry, tmp_path / "display-later", now=later)
    current = validate_live_display(tmp_path / "display-later", now=later)
    assert before["facts_versions"] == after["facts_versions"]
    assert before["display_version"] != after["display_version"]
    assert payload["providers"]["football-data"]["canonical"] == current["providers"]["football-data"]["canonical"]
    assert (first / "manifest.json").read_bytes() == canonical(before) + b"\n"


def test_replay_reuses_exact_three_file_package_excluding_publication_clock(tmp_path):
    target, _, registry, _, original = export(tmp_path)
    before = {file.name: file.read_bytes() for file in target.iterdir()}
    later = NOW + timedelta(seconds=1)
    registry.clock = lambda: later
    repeated = export_live_display(registry, target, now=later)
    assert repeated == original and {file.name: file.read_bytes() for file in target.iterdir()} == before


def test_fresh_manifest_does_not_mask_stale_source(tmp_path):
    later = NOW + timedelta(hours=1)
    _, payload, _, _, manifest = export(tmp_path, clock=later)
    provider = payload["providers"]["football-data"]
    assert manifest["generated_at"] == timestamp(later)
    assert provider["health"]["stale"] and provider["health"]["state"] == "stale"
    assert provider["health"]["last_success_at"] == timestamp(NOW - timedelta(seconds=10))


@pytest.mark.parametrize("mutate", [lambda p: p["cards"][0].update(revision=1),
    lambda p: p["cards"][0].update(status_label="Scheduled"),
    lambda p: p["cards"][0].update(day_utc="2026-10-06"),
    lambda p: p["cards"][0].update(sport="valorant"),
    lambda p: p["cards"][0].update(display_id="pandascore-0123456789abcdef"),
    lambda p: p["cards"].append(copy.deepcopy(p["cards"][0])),
    lambda p: p["cards"][0].update(winning_side="team_b"),
    lambda p: p["health"].update(scores_delayed=None),
    lambda p: p["health"].update(last_success_at=timestamp(NOW + timedelta(minutes=1))),
    lambda p: p["canonical"].update(cutoff=timestamp(NOW + timedelta(minutes=1))),
    lambda p: p["coverage"].update(displayed=True),
    lambda p: p["attribution"].update(text="Missing required source"),
    lambda p: p.update(license_note="MIT")])
def test_resealed_semantic_privacy_provider_and_clock_mutations_fail(tmp_path, mutate):
    target, _, _, _, _ = export(tmp_path)
    reseal(target, "football-data", mutate)
    with pytest.raises(DisplayError):
        validate_live_display(target, now=NOW)


def test_facts_version_is_independently_verified(tmp_path):
    target, _, _, _, _ = export(tmp_path)
    reseal(target, "football-data", lambda p: p["cards"][0].update(competition_label="Different original test league"), update_facts=False)
    with pytest.raises(DisplayError, match="facts_version"):
        validate_live_display(target, now=NOW)


@pytest.mark.parametrize("extra", ["secret.env", "cache-directory"])
def test_exact_inventory_rejects_untracked_files_or_directories(tmp_path, extra):
    target, _, _, _, _ = export(tmp_path)
    path = target / extra
    path.write_text("TEST ONLY untracked") if "." in extra else path.mkdir()
    with pytest.raises(DisplayError, match="inventory"):
        validate_live_display(target, now=NOW)


def test_tampering_unsafe_inventory_nonfinite_and_future_manifest_fail(tmp_path):
    target, _, _, _, _ = export(tmp_path)
    source = target / "football-data.json"
    before = source.read_bytes()
    source.write_bytes(b"[]")
    with pytest.raises(DisplayError, match="checksum"):
        validate_live_display(target, now=NOW)
    source.write_bytes(before)
    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["../secret"] = "0" * 64
    manifest_path.write_bytes(canonical(manifest))
    with pytest.raises(DisplayError, match="inventory"):
        validate_live_display(target, now=NOW)
    manifest.pop("files")
    manifest_path.write_text('{"generated_at":NaN}')
    with pytest.raises(DisplayError, match="invalid_json"):
        validate_live_display(target, now=NOW)


@pytest.mark.parametrize("limit", [0, 501, True])
def test_invalid_cap_is_rejected_before_capture(tmp_path, limit):
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    with pytest.raises(DisplayError, match="limit"):
        export_live_display(registry, tmp_path / "display", now=NOW, limit=limit)
    assert not (tmp_path / "display").exists()


def test_cli_offline_missing_sources_succeeds_without_provider_calls(tmp_path):
    script = Path(__file__).parents[1] / "scripts/export_live_display.py"
    command = [sys.executable, str(script), "--workspace", str(tmp_path / "missing"),
               "--output", str(tmp_path / "display"), "--clock", timestamp(NOW)]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0 and "Verified processed display" in result.stdout
    validate_live_display(tmp_path / "display", now=NOW)


def test_previous_display_recovers_failed_provider_without_freshening_facts_or_window(tmp_path):
    old, before, _, _, _ = export(tmp_path)
    later = NOW + timedelta(days=3)
    missing = LiveRegistry(tmp_path / "fresh-empty-workspace", clock=lambda: later)
    target = tmp_path / "recovered"
    manifest = export_live_display(missing, target, now=later, previous=old)
    current = validate_live_display(target, now=later)
    old_provider = before["providers"]["football-data"]
    provider = current["providers"]["football-data"]
    assert provider["cards"] == old_provider["cards"] and provider["canonical"] == old_provider["canonical"]
    assert provider["coverage"] == old_provider["coverage"] and provider["facts_version"] == old_provider["facts_version"]
    assert provider["health"]["last_success_at"] == old_provider["health"]["last_success_at"]
    assert provider["health"]["serving_last_good"] and provider["health"]["stale"]
    assert provider["health"]["state"] == "not_connected" and provider["health"]["error_code"] == "status_missing"
    assert provider["health"]["last_attempt_at"] is None  # No provider call is invented by the export.
    assert manifest["window_day_utc"] == "2026-10-09" and provider["coverage"]["window_day_utc"] == "2026-10-06"
    assert current["providers"]["pandascore"]["canonical"] is None


def test_previous_display_is_provider_specific_and_preserves_current_failed_attempt(tmp_path):
    old, before, _, _, _ = export(tmp_path)
    source = tmp_path / "new-private"
    panda = publish(source, "pandascore", [match("pandascore")])
    status(source, "pandascore", panda)
    status(source, "football-data", status="degraded", last_attempt_at=timestamp(NOW),
           last_error_code="provider_unavailable")
    registry = LiveRegistry(source, clock=lambda: NOW)
    export_live_display(registry, tmp_path / "new-display", now=NOW, previous=old)
    current = validate_live_display(tmp_path / "new-display", now=NOW)
    football = current["providers"]["football-data"]
    assert football["facts_version"] == before["providers"]["football-data"]["facts_version"]
    assert football["health"]["last_attempt_at"] == timestamp(NOW)
    assert football["health"]["error_code"] == "provider_unavailable"
    assert football["health"]["serving_last_good"] and football["health"]["stale"]
    assert not current["providers"]["pandascore"]["health"]["serving_last_good"]
    assert len(current["providers"]["pandascore"]["cards"]) == 1


def test_invalid_previous_is_rejected_not_silently_served(tmp_path):
    old, _, _, _, _ = export(tmp_path)
    (old / "pandascore.json").write_text("{}")
    registry = LiveRegistry(tmp_path / "empty", clock=lambda: NOW)
    with pytest.raises(DisplayError, match="checksum"):
        export_live_display(registry, tmp_path / "recovered", now=NOW, previous=old)
    assert not (tmp_path / "recovered").exists()


def test_duplicate_json_keys_and_future_manifest_clock_are_rejected(tmp_path):
    target, _, _, _, _ = export(tmp_path)
    path = target / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest["generated_at"] = timestamp(NOW + timedelta(seconds=1))
    path.write_bytes(canonical(manifest))
    with pytest.raises(DisplayError, match="clock"):
        validate_live_display(target, now=NOW)
    path.write_text('{"schema_version":"arena-live-display-1.0","schema_version":"arena-live-display-1.0"}')
    with pytest.raises(DisplayError, match="invalid_json"):
        validate_live_display(target, now=NOW)


def test_cross_provider_poll_scope_is_rejected_even_after_resealing(tmp_path):
    target, _, _, _, _ = export(tmp_path)
    scope = dict(kind="match_phases", competition_codes=[], phases=["past", "upcoming", "running"], pages=1)
    def mutate(payload):
        payload["health"].update(source_scope=scope, attempt_scope=scope, freshness_scope="declared_poll_scope")
    reseal(target, "football-data", mutate)
    with pytest.raises(DisplayError, match="scope"):
        validate_live_display(target, now=NOW)


def test_match_and_team_display_ids_have_separate_entity_kinds(tmp_path):
    raw = match(team_a_id="football-data:test:one")
    _, payload, _, _, _ = export(tmp_path, [raw])
    card = payload["providers"]["football-data"]["cards"][0]
    assert card["display_id"] != card["team_a"]["display_id"]


def test_changed_existing_destination_is_rejected_without_partial_overwrite(tmp_path):
    target, _, registry, source, _ = export(tmp_path)
    before = {path.name: path.read_bytes() for path in target.iterdir()}
    replacement = publish(source, rows=[match(revision=2, score_a=4)])
    status(source, snapshot=replacement)
    with pytest.raises(DisplayError, match="different_display"):
        export_live_display(registry, target, now=NOW)
    assert {path.name: path.read_bytes() for path in target.iterdir()} == before


def test_outside_or_linked_output_path_is_rejected(tmp_path):
    registry = LiveRegistry(tmp_path / "missing", clock=lambda: NOW)
    with pytest.raises(DisplayError, match="unsafe"):
        export_live_display(registry, tmp_path / "sub" / ".." / "display", now=NOW)
    link = tmp_path / "link"
    actual = tmp_path / "actual"
    actual.mkdir()
    try:
        link.symlink_to(actual, target_is_directory=True)
    except OSError:
        return
    with pytest.raises(DisplayError, match="unsafe"):
        export_live_display(registry, link / "display", now=NOW)


def newer_capture(source, *, degraded):
    row = match(revision=2, score_a=4, observed_at=timestamp(NOW + timedelta(minutes=4)))
    snapshot = publish(source, rows=[row], manifest_changes={"generated_at": timestamp(NOW + timedelta(minutes=4, seconds=30))})
    status(source, snapshot=snapshot, status="degraded" if degraded else "ready",
           last_success_at=timestamp(NOW + timedelta(minutes=4, seconds=50)),
           last_change_at=timestamp(NOW + timedelta(minutes=4, seconds=40)),
           last_attempt_at=timestamp(NOW + timedelta(minutes=5)),
           last_error_code="provider_unavailable" if degraded else None)
    return LiveRegistry(source, clock=lambda: NOW + timedelta(minutes=5))


def test_newer_verified_current_degraded_facts_are_not_hidden_by_older_public_display(tmp_path):
    old, before, _, _, _ = export(tmp_path)
    registry = newer_capture(tmp_path / "new-private", degraded=True)
    later = NOW + timedelta(minutes=5)
    target = tmp_path / "new-display"
    export_live_display(registry, target, now=later, previous=old)
    current = validate_live_display(target, now=later)["providers"]["football-data"]
    assert current["cards"][0]["score_label"] == "4–1"
    assert current["canonical"]["cutoff"] == timestamp(NOW + timedelta(minutes=4))
    assert current["health"]["last_success_at"] == timestamp(NOW + timedelta(minutes=4, seconds=50))
    assert current["facts_version"] != before["providers"]["football-data"]["facts_version"]
    assert current["health"]["serving_last_good"] and current["health"]["stale"]
    assert current["health"]["error_code"] == "provider_unavailable"


def test_demonstrably_newer_previous_public_display_replaces_older_degraded_capture(tmp_path):
    newer = newer_capture(tmp_path / "new-private", degraded=False)
    later = NOW + timedelta(minutes=5)
    previous = tmp_path / "newer-previous"
    export_live_display(newer, previous, now=later)
    old_source = tmp_path / "old-private"
    snapshot = publish(old_source)
    status(old_source, snapshot=snapshot, status="degraded", last_attempt_at=timestamp(later),
           last_error_code="provider_unavailable")
    registry = LiveRegistry(old_source, clock=lambda: later)
    target = tmp_path / "recovered-display"
    export_live_display(registry, target, now=later, previous=previous)
    current = validate_live_display(target, now=later)["providers"]["football-data"]
    prior = validate_live_display(previous, now=later)["providers"]["football-data"]
    assert current["cards"] == prior["cards"] and current["canonical"] == prior["canonical"]
    assert current["health"]["last_success_at"] == prior["health"]["last_success_at"]
    assert current["health"]["last_attempt_at"] == timestamp(later)
    assert current["health"]["stale"] and current["health"]["serving_last_good"]


def test_equal_clocks_keep_current_verified_degraded_facts(tmp_path):
    old, _, _, _, _ = export(tmp_path)
    source = tmp_path / "current-private"
    snapshot = publish(source, rows=[match(revision=2, score_a=4)])
    status(source, snapshot=snapshot, status="degraded", last_error_code="provider_unavailable")
    registry = LiveRegistry(source, clock=lambda: NOW)
    export_live_display(registry, tmp_path / "current-display", now=NOW, previous=old)
    current = validate_live_display(tmp_path / "current-display", now=NOW)["providers"]["football-data"]
    assert current["cards"][0]["score_label"] == "4–1" and current["health"]["stale"]
