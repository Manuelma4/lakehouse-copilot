"""Original TEST ONLY packages; independent of producer imports or acquisition."""

import copy
import hashlib
import json
import os
from datetime import timedelta

import pytest

from arena_copilot.current_publication import (
    CALENDAR_FILES, MAX_FILE_BYTES, PHASES, Descriptor, PairError, canonical,
    load_calendar, parse_publication,
)
from arena_copilot.live import LiveRegistry, LiveStatus
from test_live import NOW, match, publish, status, timestamp

SCOPE = dict(kind="match_phases", competition_codes=[], phases=list(PHASES), pages=1)


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def business(identity=7, *, resolved=False, tournament_id=80):
    start = timestamp(NOW + timedelta(days=1))
    metadata = dict(id=f"pandascore:tournament:{tournament_id}", source_id=tournament_id,
                    name="TEST ONLY Playoffs", full_name=None, begin_at=None, end_at=None,
                    modified_at=None, season=None, year=None)
    return dict(announcement_id=f"pandascore:{identity}", provider="pandascore", sport="valorant",
                name="TEST ONLY Announcement", source_status="not_started", start_time=start,
                source_dates=dict(begin_at=start, scheduled_at=None, original_scheduled_at=None,
                                  end_at=None, modified_at=None),
                team_a=dict(team_id="pandascore:1", source_team_id=1, team_name="TEST ONLY Maple")
                if resolved else None,
                team_b=dict(team_id="pandascore:2", source_team_id=2, team_name="TEST ONLY Pine")
                if resolved else None,
                league=None, series=None, tournament=metadata, source_number_of_games=None,
                source_results=[], result_known=False,
                pending_reasons=[] if resolved else ["unresolved_opponents"])


def calendar(base, rows=None, *, observed=None, links=(), mutation=None):
    observed = observed or NOW - timedelta(seconds=60)
    observed_at, requested_at = timestamp(observed), timestamp(observed-timedelta(seconds=1))
    rows = [business()] if rows is None else rows
    sources, occurrences, announcements = [], [], []
    for phase in PHASES:
        source_id = f"pandascore:valorant:{phase}:page:1"
        sources.append(dict(source_id=source_id, provider="pandascore", phase=phase, page=1,
                            per_page=100, endpoint=f"valorant/matches/{phase}?page=1&per_page=100",
                            requested_at=requested_at, observed_at=observed_at,
                            archive_sha256=digest(dict(test_only=phase)),
                            record_count=len(rows) if phase == "upcoming" else 0))
        if phase == "upcoming":
            for index, row in enumerate(rows):
                occurrence_id = f"{source_id}:row:{index:03d}"
                occurrences.append(dict(**row, occurrence_id=occurrence_id, source_id=source_id,
                                        observed_at=observed_at))
                announcements.append(dict(**row, canonical_match_id=row["announcement_id"]
                                          if row["announcement_id"] in links else None,
                                          observed_at=observed_at, first_observed_at=observed_at,
                                          last_observed_at=observed_at, source_ids=[source_id],
                                          occurrence_ids=[occurrence_id], conflicted=False))
    announcements.sort(key=lambda row: row["announcement_id"])
    quality = dict(source_records=len(occurrences), announcements=len(announcements), duplicate_occurrences=0,
                   conflicted_announcements=0, pending_announcements=sum(bool(r["pending_reasons"]) for r in rows),
                   unresolved_opponents=sum("unresolved_opponents" in r["pending_reasons"] for r in rows),
                   unresolved_start_time=sum("unresolved_start_time" in r["pending_reasons"] for r in rows),
                   results_known=sum(r["result_known"] for r in rows),
                   canonical_linked=sum(r["canonical_match_id"] is not None for r in announcements),
                   source_phases=list(PHASES), pages_per_phase=1,
                   coverage_note="Bounded provider pages from one completed poll; not a complete event calendar or in-game feed.",
                   result_note="Scores are source-reported series results. Upcoming zero scores remain unconfirmed; no rounds inferred.")
    payload = dict(announcements=announcements, occurrences=occurrences, sources=sources, quality=quality)
    if mutation:
        mutation(payload)
    version = digest(payload)[:16]
    directory = base / "pandascore/calendars" / f"calendar-{version}"
    directory.mkdir(parents=True, exist_ok=True)
    files = {}
    for name in CALENDAR_FILES:
        body = canonical(payload[name.removesuffix(".json")]) + b"\n"
        (directory / name).write_bytes(body)
        files[name] = hashlib.sha256(body).hexdigest()
    counts = {key: quality[key] for key in ("source_records", "announcements", "duplicate_occurrences",
                                          "conflicted_announcements", "pending_announcements", "canonical_linked")}
    manifest = dict(schema_version="arena-provider-calendar-1.0", provider="pandascore", data_kind="api",
                    dataset_version=version, generated_at=timestamp(observed+timedelta(seconds=2)),
                    as_of=observed_at, source_scope=copy.deepcopy(SCOPE), counts=dict(counts, sources=len(sources)),
                    files=files, publication_note="TEST ONLY private calendar contract fixture")
    (directory / "manifest.json").write_bytes(canonical(manifest) + b"\n")
    return directory


def descriptor(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    return dict(basename=directory.name, dataset_version=manifest["dataset_version"],
                manifest_sha256=hashlib.sha256((directory / "manifest.json").read_bytes()).hexdigest())


def select(base, package, snapshot=None, *, poll_id=1, collected=None, selected=None, **changes):
    collected = collected or NOW-timedelta(seconds=50)
    selected = selected or collected+timedelta(seconds=10)
    payload = dict(schema_version="arena-provider-publication-1.0", provider="pandascore", data_kind="api",
                   poll_id=poll_id, source_scope=copy.deepcopy(SCOPE), collected_at=timestamp(collected),
                   selected_at=timestamp(selected), canonical=descriptor(snapshot) if snapshot else None,
                   calendar=descriptor(package))
    payload.update(changes)
    payload["fingerprint"] = digest(payload)
    path = base / "pandascore/snapshots/CURRENT_PUBLICATION.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical(payload)+b"\n")
    return payload


def paired_status(base, snapshot=None, **changes):
    defaults = dict(status="ready" if snapshot else "empty", source_scope=copy.deepcopy(SCOPE),
                    last_attempt_at=timestamp(NOW-timedelta(seconds=61)),
                    last_success_at=timestamp(NOW-timedelta(seconds=10)), last_error_code=None)
    defaults.update(changes)
    return status(base, "pandascore", snapshot, **defaults)


@pytest.mark.parametrize("rows", [[], [business()]])
def test_calendar_only_empty_or_all_unresolved_is_verified_ready(tmp_path, rows):
    package = calendar(tmp_path, rows)
    selector = select(tmp_path, package)
    paired_status(tmp_path)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    captured = registry.capture("pandascore")
    health = registry._envelope(captured)
    assert captured.state == "ready" and captured.dataset is None
    assert captured.calendar is not None and len(captured.calendar.announcements) == len(rows)
    assert captured.publication.fingerprint == selector["fingerprint"]
    assert health["snapshot_available"] is False and health["calendar_available"] is True
    assert health["last_success_at"] == selector["collected_at"] and not health["stale"]
    assert health["status_alignment"] == "unavailable"  # Late ledger completion is the same poll.
    assert registry.matches("pandascore")["rows"] == []
    with pytest.raises(TypeError):
        captured.calendar.manifest["counts"]["sources"] = 99
    if rows:
        with pytest.raises(ValueError):
            captured.calendar.announcements[0].tournament.name = "changed"


def test_calendar_facts_exclude_observation_clocks_and_keep_same_named_event_ids(tmp_path):
    rows = [business(7, tournament_id=80), business(8, tournament_id=81)]
    first = calendar(tmp_path, rows)
    second = calendar(tmp_path, rows, observed=NOW-timedelta(seconds=30))
    a = load_calendar(first, Descriptor.model_validate(descriptor(first)), NOW)
    b = load_calendar(second, Descriptor.model_validate(descriptor(second)), NOW)
    assert a.calendar_fingerprint != b.calendar_fingerprint and a.facts_version == b.facts_version
    assert [row.tournament.id for row in b.announcements] == ["pandascore:tournament:80", "pandascore:tournament:81"]
    assert len(b.by_id) == 2


def test_changed_bad_calendar_rejects_both_new_members_and_preserves_request_pair(tmp_path):
    old_snapshot = publish(tmp_path, "pandascore", [match("pandascore", match_id="pandascore:7")])
    old_calendar = calendar(tmp_path, [business(resolved=True)], links=["pandascore:7"])
    select(tmp_path, old_calendar, old_snapshot)
    paired_status(tmp_path, old_snapshot)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    before = registry.capture("pandascore")
    new_snapshot = publish(tmp_path, "pandascore", [match("pandascore", revision=2, score_b=0, match_id="pandascore:7")])
    new_calendar = calendar(tmp_path, observed=NOW-timedelta(seconds=30))
    select(tmp_path, new_calendar, new_snapshot, poll_id=2, collected=NOW-timedelta(seconds=25))
    paired_status(tmp_path, new_snapshot)
    (new_calendar / "announcements.json").write_bytes(b"[]\n")
    after = registry.capture("pandascore")
    assert after.state == "invalid_publication" and after.serving_last_good
    assert after.dataset is before.dataset and after.calendar is before.calendar
    assert after.publication is before.publication
    assert after.dataset.by_id["pandascore:7"].score_b == 1
    assert registry._envelope(after)["stale"]


def test_new_calendar_can_link_retained_canonical_despite_current_null_fields_and_status_pointer(tmp_path):
    snapshot = publish(tmp_path, "pandascore", [match("pandascore", match_id="pandascore:7")])
    package = calendar(tmp_path, links=["pandascore:7"])
    select(tmp_path, package, snapshot)
    paired_status(tmp_path, status="empty", latest_snapshot=None,
                  last_change_at=timestamp(NOW-timedelta(minutes=1)))
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    captured = registry.capture("pandascore")
    assert captured.state == "ready" and captured.dataset.by_id["pandascore:7"].team_a is not None
    assert captured.calendar.by_id["pandascore:7"].team_a is None
    assert captured.calendar.by_id["pandascore:7"].canonical_match_id == "pandascore:7"
    assert captured.status.latest_snapshot is None
    assert registry.matches("pandascore")["rows"][0]["score_a"] == 2


def test_stale_collection_age_comes_from_selector_not_status_success(tmp_path):
    package = calendar(tmp_path, observed=NOW-timedelta(minutes=10))
    selector = select(tmp_path, package, collected=NOW-timedelta(minutes=9))
    paired_status(tmp_path, last_attempt_at=timestamp(NOW-timedelta(minutes=10)))
    health = LiveRegistry(tmp_path, clock=lambda: NOW).provider_health("pandascore")
    assert health["status"] == "stale" and health["poll_age_seconds"] == 540
    assert health["last_success_at"] == selector["collected_at"]
    assert health["status_last_success_at"] == timestamp(NOW-timedelta(seconds=10))


def test_legacy_absence_is_explicit_and_bad_seen_selector_never_downgrades(tmp_path):
    snapshot = publish(tmp_path, "pandascore")
    status(tmp_path, "pandascore", snapshot)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    legacy = registry.capture("pandascore")
    assert legacy.selection_mode == "legacy" and legacy.dataset is not None
    assert registry._envelope(legacy)["calendar_unavailable_reason"] == "legacy_status_only"
    pointer = tmp_path / "pandascore/snapshots/CURRENT_PUBLICATION.json"
    pointer.write_bytes(b"{broken selector")
    bad = registry.capture("pandascore")
    pointer.unlink()
    missing = registry.capture("pandascore")
    assert bad.selection_mode == missing.selection_mode == "paired"
    assert bad.state == missing.state == "invalid_publication"
    assert missing.dataset is legacy.dataset and missing.calendar is None


@pytest.mark.parametrize("change", [
    {"poll_id": True}, {"poll_id": 0}, {"selected_at": "2026-10-07T00:00:00Z"},
    {"source_scope": dict(SCOPE, phases=["past"])},
    {"calendar": dict(basename="../calendar-0123456789abcdef", dataset_version="0123456789abcdef", manifest_sha256="0"*64)},
    {"calendar": dict(basename="calendar-0123456789abcdef", dataset_version="fedcba9876543210", manifest_sha256="0"*64)},
])
def test_selector_contract_future_scope_and_path_boundaries(tmp_path, change):
    package = calendar(tmp_path)
    select(tmp_path, package, **change)
    captured = LiveRegistry(tmp_path, clock=lambda: NOW).capture("pandascore")
    assert captured.state == "invalid_publication" and captured.calendar is None
    assert captured.selection_mode == "paired"


def test_selector_hashes_original_decoded_fields_before_timestamp_normalization(tmp_path):
    package = calendar(tmp_path)
    value = select(tmp_path, package, collected_at="2026-10-06T15:59:10+02:00",
                   selected_at="2026-10-06T15:59:20+02:00")
    parsed = parse_publication(canonical(value), "pandascore", NOW)
    assert parsed.collected_at == "2026-10-06T13:59:10.000000Z"
    assert parsed.fingerprint == value["fingerprint"]
    value["collected_at"] = parsed.collected_at
    with pytest.raises(PairError, match="publication_fingerprint_mismatch"):
        parse_publication(canonical(value), "pandascore", NOW)


@pytest.mark.parametrize("body", [b'{"poll_id":1,"poll_id":2}', b'{"poll_id":NaN}', b'\xff'])
def test_selector_rejects_duplicate_and_nonfinite_json(body):
    with pytest.raises(PairError):
        parse_publication(body, "pandascore", NOW)


@pytest.mark.parametrize("mutation", [
    lambda p: p["occurrences"][0].update(result_known=True),
    lambda p: p["sources"][0].update(record_count=1),
    lambda p: p["announcements"][0].update(canonical_match_id="pandascore:99"),
    lambda p: p["quality"].update(announcements=99),
    lambda p: p["occurrences"][0].update(announcement_id="pandascore:9999999999999999"),
    lambda p: p["occurrences"][0].update(name=" "),
    lambda p: p["occurrences"][0].update(extra="private"),
])
def test_rehashed_calendar_still_checks_derived_links_counts_and_strict_types(tmp_path, mutation):
    package = calendar(tmp_path, mutation=mutation)
    select(tmp_path, package)
    captured = LiveRegistry(tmp_path, clock=lambda: NOW).capture("pandascore")
    assert captured.state == "invalid_publication" and captured.calendar is None


def test_same_size_and_mtime_tamper_is_detected_and_preserves_pair(tmp_path):
    package = calendar(tmp_path)
    select(tmp_path, package)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    good = registry.capture("pandascore")
    path = package / "announcements.json"
    info = path.stat()
    path.write_bytes(path.read_bytes().replace(b"TEST ONLY Playoffs", b"TEST ONLY Changed!"))
    os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns))
    assert path.stat().st_size == info.st_size
    bad = registry.capture("pandascore")
    assert bad.state == "invalid_publication" and bad.calendar is good.calendar


def test_missing_manifest_wrong_descriptor_and_file_size_are_rejected(tmp_path):
    package = calendar(tmp_path)
    value = descriptor(package)
    with pytest.raises(PairError, match="calendar_manifest_mismatch"):
        load_calendar(package, Descriptor.model_validate(dict(value, manifest_sha256="0"*64)), NOW)
    path = package / "occurrences.json"
    with path.open("wb") as handle:
        handle.truncate(MAX_FILE_BYTES+1)
    with pytest.raises(PairError, match="size_or_type_limit"):
        load_calendar(package, Descriptor.model_validate(value), NOW)
    (package / "manifest.json").unlink()
    with pytest.raises(PairError, match="calendar_inventory_mismatch"):
        load_calendar(package, Descriptor.model_validate(value), NOW)


def test_status_alignment_requires_identity_and_accounts_for_late_ledger_finish(tmp_path):
    package = calendar(tmp_path)
    value = select(tmp_path, package)
    publication = parse_publication(canonical(value), "pandascore", NOW)
    payload = paired_status(tmp_path)
    assert LiveRegistry._alignment(LiveStatus.model_validate(payload), publication) == "unavailable"
    payload["poll_id"] = 1
    assert LiveRegistry._alignment(LiveStatus.model_validate(payload), publication) == "same_collection"
    payload.pop("poll_id")
    payload.update(status="degraded", last_error_code="network_timeout",
                   last_attempt_at=timestamp(NOW-timedelta(seconds=15)))
    assert LiveRegistry._alignment(LiveStatus.model_validate(payload), publication) == "newer_attempt"
    payload.update(status="empty", last_error_code=None)
    assert LiveRegistry._alignment(LiveStatus.model_validate(payload), publication) == "different_collection"


@pytest.mark.parametrize("changes", [
    {"generated_at": "2026-10-07T00:00:00.000000Z"},
    {"as_of": "2026-10-06T13:59:01.000000Z"},
    {"source_scope": dict(SCOPE, pages=2)},
    {"dataset_version": "0"*16},
])
def test_rehashed_manifest_future_clock_scope_and_version_boundaries(tmp_path, changes):
    package = calendar(tmp_path)
    manifest_path = package / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.update(changes)
    manifest_path.write_bytes(canonical(manifest)+b"\n")
    # Keep the descriptor version tied to the approved basename so a modified
    # internal version is validated at the member boundary.
    value = descriptor(package)
    value["dataset_version"] = package.name.removeprefix("calendar-")
    with pytest.raises(PairError):
        load_calendar(package, Descriptor.model_validate(value), NOW)


def test_calendar_package_and_file_links_are_rejected(tmp_path):
    package = calendar(tmp_path)
    value = Descriptor.model_validate(descriptor(package))
    linked = tmp_path / "linked-calendar"
    try:
        linked.symlink_to(package, target_is_directory=True)
    except OSError as error:
        pytest.skip(f"Platform does not permit test symlinks: {error.errno}")
    with pytest.raises(PairError, match="unsafe_path"):
        load_calendar(linked, value, NOW)
    original = package / "quality.json"
    outside = tmp_path / "outside-quality.json"
    original.replace(outside)
    original.symlink_to(outside)
    with pytest.raises(PairError, match="unsafe_path"):
        load_calendar(package, value, NOW)


def test_pair_clock_coherence_and_manifest_descriptor_hash(tmp_path):
    snapshot = publish(tmp_path, "pandascore", [match("pandascore", match_id="pandascore:7")])
    package = calendar(tmp_path)
    select(tmp_path, package, snapshot,
           canonical=dict(descriptor(snapshot), manifest_sha256="0"*64))
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    assert registry.capture("pandascore").state == "invalid_publication"
    select(tmp_path, package, snapshot, collected=NOW-timedelta(seconds=61))
    assert registry.capture("pandascore").state == "invalid_publication"
    assert registry.capture("pandascore").calendar is None


def test_selector_freshness_survives_unavailable_attempt_telemetry_and_scope_is_authority(tmp_path):
    package = calendar(tmp_path)
    selector = select(tmp_path, package)
    registry = LiveRegistry(tmp_path, clock=lambda: NOW)
    health = registry.provider_health("pandascore")
    assert health["status"] == "ready" and not health["stale"]
    assert health["source_scope"] == selector["source_scope"] and health["attempt_scope"] is None
    assert health["producer_status"] is None and health["publication_error_code"] == "status_missing"
