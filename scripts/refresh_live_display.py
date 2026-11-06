"""Collect one bounded private provider view and publish processed own-site cards.

Run by one trusted deployment owner only. Licensed raw responses and ingestion
state stay in the ephemeral workspace; only the validated display is deployed.
"""

import argparse
import json
import tempfile
from pathlib import Path

import httpx

from arena_copilot.live import LiveRegistry
from arena_copilot.live_publication import DisplayError, export_live_display, validate_live_display

OWN_SITE_CURRENT = "https://manuelma4.github.io/lakehouse-copilot/current/"
DISPLAY_FILES = {"manifest.json": 64 * 1024, "football-data.json": 2 * 1024 * 1024,
                 "pandascore.json": 2 * 1024 * 1024}
COMPETITIONS = ("PL", "PD", "BL1", "SA", "FL1", "BSA")


class RefreshError(ValueError):
    """Safe fixed error code; never include response bodies or credentials."""


def download_previous(client, target: Path, *, base=OWN_SITE_CURRENT):
    """Read exactly three bounded files from this application's fixed HTTPS origin.

    No redirects, provider requests, raw-source caches, arbitrary hosts or URLs.
    A first deployment has no manifest. An unavailable previous site cannot offer
    last-good recovery; an available but invalid package fails validation.
    """
    if base != OWN_SITE_CURRENT:
        raise RefreshError("invalid_previous_origin")
    target.mkdir()
    for name, bound in DISPLAY_FILES.items():
        try:
            with client.stream("GET", base + name, follow_redirects=False,
                               headers={"Accept": "application/json"}) as response:
                if response.status_code == 404 and name == "manifest.json":
                    return None, "not_published"
                if response.status_code != 200:
                    return None, "previous_site_unavailable"
                length = response.headers.get("Content-Length")
                if length is not None and (not length.isdigit() or int(length) > bound):
                    raise RefreshError("previous_package_too_large")
                count = 0
                with (target / name).open("xb") as handle:
                    for block in response.iter_bytes(65536):
                        count += len(block)
                        if count > bound:
                            raise RefreshError("previous_package_too_large")
                        handle.write(block)
        except httpx.HTTPError:
            return None, "previous_site_unavailable"
    try:
        validate_live_display(target)
    except (DisplayError, ValueError, OSError):
        raise RefreshError("previous_package_invalid") from None
    return target, "validated"


def collect_private(workspace: Path):
    """Optional producer dependency; one poll/provider, private state only."""
    from arena_lakehouse.live import LiveConfig, LiveWorker

    results = {}
    for provider in ("football-data", "pandascore"):
        config = LiveConfig(provider, interval=3600,
                           competitions=COMPETITIONS if provider == "football-data" else None)
        result = LiveWorker(workspace, config).poll_once()
        results[provider] = {key: result[key] for key in ("status", "last_error_code", "last_poll")}
    return results


def refresh(workspace: Path, output: Path, *, previous=None, collector=collect_private):
    """Use a new private workspace; failed providers remain explicit or last-good."""
    if workspace.exists() or workspace.is_symlink():
        raise RefreshError("private_workspace_must_be_new")
    workspace.mkdir(parents=True)
    results = collector(workspace)
    registry = LiveRegistry(workspace)
    try:
        manifest = export_live_display(registry, output, previous=previous, schema_version="arena-live-display-2.0")
    finally:
        registry.close()
    checked = validate_live_display(output)
    return dict(display_version=manifest["display_version"], package_fingerprint=manifest["package_fingerprint"],
                providers={provider: dict(state=payload["health"]["state"],
                    displayed=payload["coverage"]["displayed"], stale=payload["health"]["stale"],
                    serving_last_good=payload["health"]["serving_last_good"])
                    for provider, payload in checked["providers"].items()}, collection=results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True, help="New ephemeral private ingestion directory")
    parser.add_argument("--output", type=Path, required=True, help="New processed display destination")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--previous-package", type=Path, help="Validated local own-site display for recovery")
    group.add_argument("--previous-base", choices=[OWN_SITE_CURRENT], help="Fixed own-site display origin")
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix="arena-own-display-") as temporary:
            previous, bootstrap = args.previous_package, "local" if args.previous_package else "not_requested"
            if args.previous_base:
                with httpx.Client(timeout=20, follow_redirects=False) as client:
                    previous, bootstrap = download_previous(client, Path(temporary) / "previous", base=args.previous_base)
            report = refresh(args.workspace, args.output, previous=previous)
            report["previous_display"] = bootstrap
    except (RefreshError, DisplayError, ValueError, OSError):
        parser.exit(1, "Current display refresh failed; inspect the bounded private workspace and display contract.\n")
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
