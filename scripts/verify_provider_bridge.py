"""Exercise both repositories with original mock responses and no network access.

Requires the producer as an optional dependency. This is an integration probe,
not a provider-coverage, model-quality or managed-platform measurement.
"""

import argparse
import copy
import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from arena_copilot.live import LiveRegistry
from arena_copilot.live_publication import export_live_display, local_display_envelope, validate_live_display


class Clock:
    def __init__(self):
        self.value = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)

    def __call__(self):
        return self.value

    def advance(self):
        self.value += timedelta(seconds=60)


@contextmanager
def mock_credentials():
    names = ("FOOTBALL_DATA_TOKEN", "PANDASCORE_TOKEN")
    previous = {name: os.environ.get(name) for name in names}
    for name in names:
        os.environ[name] = "original-offline-bridge-fixture"
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def panda(identity, *, begin="2026-10-07T18:00:00Z", opponents=True, status="not_started",
          scores=(0, 0), best_of=3, opponent_type="Team"):
    return dict(id=identity, name=f"TEST ONLY Match {identity}", status=status, begin_at=begin,
        number_of_games=best_of,
        league=dict(id=10, name="TEST ONLY Circuit"),
        serie=dict(id=20, name=None, full_name="TEST ONLY Autumn 2026", season="Autumn", year=2026),
        tournament=dict(id=80, name="TEST ONLY Playoffs"),
        opponents=[dict(type=opponent_type, opponent=dict(id=ident, name=f"TEST ONLY Team {ident}"))
                   for ident in (1, 2)] if opponents else [],
        results=[dict(team_id=ident, score=score) for ident, score in zip((1, 2), scores, strict=True)]
                if opponents else [])


def fixtures():
    pending = panda(201, begin=None, opponents=False)
    date_only = panda(203, begin="2026-10-07")
    date_only["tournament"] = None
    return dict(past=[panda(205, begin="2026-10-05T10:00:00Z", status="finished",
                            scores=(1000, 999), best_of=101)],
        upcoming=[pending, panda(204, begin="2026-10-06T10:00:00Z"), date_only,
                  panda(206, begin="2026-10-07T18:00:00"), panda(207, opponent_type="Player")],
        running=[])


def run(output):
    from arena_lakehouse.live import LiveConfig, LiveWorker
    from arena_lakehouse.provider_publication import current_publication

    output = Path(output).absolute()
    if output.exists() or ".." in output.parts:
        raise ValueError("Use a new integration evidence directory")
    output.mkdir(parents=True)
    private, clock, responses, calls = output/"private", Clock(), fixtures(), []
    failure = False

    def respond(request):
        # MockTransport intercepts every request. No socket or real credentials
        # can reach a provider, including when injecting an HTTP failure.
        host, phase = request.url.host, request.url.path.rsplit("/", 1)[-1]
        calls.append(dict(host=host, phase=phase))
        if host == "api.football-data.org":
            raw = dict(id=101, utcDate="2026-10-07T18:00:00Z", status="SCHEDULED",
                competition=dict(name="TEST ONLY Football Cup"),
                homeTeam=dict(id=1, name="TEST ONLY Home"), awayTeam=dict(id=2, name="TEST ONLY Away"),
                score=dict(fullTime=dict(home=None, away=None)))
            return httpx.Response(200, json=dict(matches=[raw]))
        if host != "api.pandascore.co" or phase not in responses:
            raise AssertionError("Unexpected mock request")
        if failure and phase == "upcoming":
            return httpx.Response(403, json=dict(error="TEST ONLY denial"))
        return httpx.Response(200, json=copy.deepcopy(responses[phase]))

    measurements = []
    with mock_credentials(), httpx.Client(transport=httpx.MockTransport(respond)) as client:
        football = LiveWorker(private, LiveConfig("football-data"), client=client, clock=clock)
        football_status = football.poll_once()
        assert football_status["status"] == "ready"
        worker = LiveWorker(private, LiveConfig("pandascore"), client=client, clock=clock)
        registry = LiveRegistry(private, clock=clock)

        def capture_stage(name):
            status = worker.poll_once()
            selected = current_publication(worker.root, now=clock())
            envelope = local_display_envelope(registry, now=clock())
            destination = output/name
            export_live_display(registry, destination, now=clock(), schema_version="arena-live-display-2.0")
            checked = validate_live_display(destination, now=clock())
            payload = checked["providers"]["pandascore"]
            assert payload["publication"]["fingerprint"] == selected["fingerprint"]
            assert payload["health"]["last_success_at"] == selected["collected_at"]
            assert payload["calendar"]["dataset_version"] == selected["calendar"]["dataset_version"]
            for path in destination.iterdir():
                raw = path.read_bytes()
                assert b'"source_id":' not in raw and b"archive_sha256" not in raw
                assert b"pandascore:201" not in raw and b"original-offline-bridge-fixture" not in raw
            measurements.append(dict(stage=name, status=status["status"], last_error_code=status["last_error_code"],
                canonical_matches=len(registry.capture("pandascore").dataset.by_id),
                announcements=payload["coverage"]["retained_total"], displayed=payload["coverage"]["displayed"],
                pending=payload["coverage"]["pending_displayed"], facts_version=payload["facts_version"],
                publication_fingerprint=payload["publication"]["fingerprint"],
                source_check=payload["health"]["last_success_at"],
                state=payload["health"]["state"], serving_last_good=payload["health"]["serving_last_good"]))
            return status, selected, payload, envelope["canonical_links"]["pandascore"]

        initial_status, _, initial, links = capture_stage("initial")
        assert initial_status["status"] == "ready"
        assert len(registry.capture("pandascore").dataset.by_id) == 1
        announcements = registry.capture("pandascore").calendar.by_id
        pending_id = next(card["display_id"] for card in initial["cards"]
                          if card["announcement_label"] == "TEST ONLY Match 201")
        assert announcements["pandascore:203"].start_time is None
        assert "start_time_timezone_unknown" in announcements["pandascore:206"].pending_reasons
        assert "unsupported_opponent_type" in announcements["pandascore:207"].pending_reasons
        high = next(card for card in initial["cards"] if card["announcement_label"] == "TEST ONLY Match 205")
        assert high["score_label"] == "1000–999" and high["result_state"] == "source_reported"
        assert high["series_format"] == "Best of 101" and high["winning_side"] is None
        assert pending_id not in links

        responses["upcoming"][0] = panda(201)
        clock.advance()
        _, _, resolved, links = capture_stage("resolved")
        card = next(card for card in resolved["cards"] if card["display_id"] == pending_id)
        assert card["association_state"] == "matches_latest_announcement" and card["resolution"] == "validated"
        assert card["score_label"] is None and links[pending_id]["match_id"] == "pandascore:201"
        previous_events = worker.pipeline.events()
        previous_cursor = json.loads(worker.cursor.read_bytes())
        assert len(previous_events) == 2

        responses["running"] = [panda(204, begin="2026-10-06T10:00:00Z", status="running", scores=(1, 0))]
        clock.advance()
        conflict_status, conflict_selection, conflicted, links = capture_stage("conflicted")
        assert conflict_status["status"] == "ready" and worker.pipeline.events() == previous_events
        assert json.loads(worker.cursor.read_bytes())["pandascore:204"] == previous_cursor["pandascore:204"]
        conflict_card = next(card for card in conflicted["cards"] if card["announcement_label"] == "TEST ONLY Match 204")
        assert conflict_card["resolution"] == "conflicted" and conflict_card["score_label"] is None
        assert "conflicting_phase_records" in conflict_card["pending_reasons"]
        assert conflict_card["display_id"] not in links

        failure = True
        clock.advance()
        failed_status, failed_selection, failed, _ = capture_stage("last-good")
        assert failed_status["last_error_code"] == "authentication_denied"
        assert failed_selection == conflict_selection and worker.pipeline.events() == previous_events
        assert failed["cards"] == conflicted["cards"] and failed["facts_version"] == conflicted["facts_version"]
        assert failed["health"]["last_success_at"] == conflicted["health"]["last_success_at"]
        assert failed["health"]["serving_last_good"] and failed["health"]["stale"]
        registry.close()

    report = dict(scope="Original offline producer-to-consumer integration with intercepted HTTP responses",
        status="passed", schema_version="arena-live-display-2.0", mocked_http_requests=len(calls),
        provider_network_requests=0, model_requests=0, spark_runs=0, shared_environment_install=False,
        measurements=measurements, request_phases=calls,
        limits="Does not verify live-provider breadth, actual sporting results, model generation or Databricks execution")
    (output/"report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New offline integration evidence directory")
    args = parser.parse_args()
    result = run(args.output)
    print(json.dumps(dict(status=result["status"], mocked_http_requests=result["mocked_http_requests"],
                          provider_network_requests=0, model_requests=0, stages=len(result["measurements"]))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
