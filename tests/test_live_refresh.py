"""Original TEST ONLY snapshots and mocked own-site transport; no credentials."""

import importlib.util
from pathlib import Path

import httpx
import pytest

from arena_copilot.live import LiveRegistry
from arena_copilot.live_publication import export_live_display, validate_live_display
from test_live import NOW, publish, status

spec = importlib.util.spec_from_file_location("refresh_live_display", Path(__file__).parents[1] / "scripts/refresh_live_display.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def package(tmp_path):
    private = tmp_path / "original"
    snap = publish(private)
    status(private, snapshot=snap)
    registry = LiveRegistry(private, clock=lambda: NOW)
    try:
        export_live_display(registry, tmp_path / "display", now=NOW, schema_version="arena-live-display-2.0")
    finally:
        registry.close()
    return tmp_path / "display"


def test_bootstrap_reads_only_fixed_three_display_files_and_validates(tmp_path):
    previous = package(tmp_path)
    requests = []
    def respond(request):
        requests.append(str(request.url))
        assert not request.headers.get("authorization")
        return httpx.Response(200, content=(previous / request.url.path.rsplit("/", 1)[1]).read_bytes())
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        downloaded, state = module.download_previous(client, tmp_path / "previous")
    assert state == "validated" and len(requests) == 3
    assert requests == [module.OWN_SITE_CURRENT + name for name in module.DISPLAY_FILES]
    assert validate_live_display(downloaded)["manifest"] == validate_live_display(previous)["manifest"]


@pytest.mark.parametrize("code, expected", [(404, "not_published"), (301, "previous_site_unavailable"),
                                             (403, "previous_site_unavailable"), (503, "previous_site_unavailable")])
def test_first_deployment_or_unreachable_site_has_no_unverified_fallback(tmp_path, code, expected):
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(code, headers={"Location": "https://api.pandascore.co/private"})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert module.download_previous(client, tmp_path / "previous") == (None, expected)
    assert len(requests) == 1


def test_arbitrary_origin_rejected_before_any_request(tmp_path):
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("Unexpected request"))) as client:
        with pytest.raises(module.RefreshError, match="invalid_previous_origin"):
            module.download_previous(client, tmp_path / "previous", base="https://localhost/current/")


@pytest.mark.parametrize("declared", [None, "999999999", "not-a-number"])
def test_oversized_display_is_bounded_even_without_length(tmp_path, declared):
    headers = {"Content-Length": declared} if declared else {}
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, headers=headers,
                      stream=httpx.ByteStream(b"x" * 65537)))) as client:
        with pytest.raises(module.RefreshError, match="previous_package_too_large"):
            module.download_previous(client, tmp_path / "previous")


def test_reachable_tampered_previous_package_fails_instead_of_silent_recovery(tmp_path):
    previous = package(tmp_path)
    def respond(request):
        name = request.url.path.rsplit("/", 1)[1]
        content = (previous / name).read_bytes()
        return httpx.Response(200, content=content + b" " if name == "pandascore.json" else content)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(module.RefreshError, match="previous_package_invalid"):
            module.download_previous(client, tmp_path / "previous")


def test_provider_failure_retains_only_verified_previous_display_and_source_clock(tmp_path):
    previous = package(tmp_path)
    before = validate_live_display(previous)["providers"]["football-data"]
    calls = []
    def unavailable(workspace):
        calls.append(workspace)
        return {"football-data": {"status": "awaiting_credentials"}, "pandascore": {"status": "awaiting_credentials"}}
    result = module.refresh(tmp_path / "new-private", tmp_path / "new-display", previous=previous, collector=unavailable)
    after = validate_live_display(tmp_path / "new-display")["providers"]["football-data"]
    assert len(calls) == 1 and result["providers"]["football-data"]["serving_last_good"]
    assert after["cards"] == before["cards"] and after["canonical"] == before["canonical"]
    assert after["health"]["last_success_at"] == before["health"]["last_success_at"]
    assert after["health"]["stale"] and after["coverage"] == before["coverage"]


def test_existing_workspace_cannot_launch_second_collection_owner(tmp_path):
    existing = tmp_path / "existing"
    existing.mkdir()
    with pytest.raises(module.RefreshError, match="private_workspace_must_be_new"):
        module.refresh(existing, tmp_path / "display", collector=lambda _: pytest.fail("Unsafe collection"))
