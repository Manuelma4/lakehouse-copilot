"""Build a processed own-site display artifact from verified private live data."""

import argparse
from pathlib import Path

from arena_copilot.live import LiveRegistry
from arena_copilot.live_publication import DisplayError, export_live_display
from arena_copilot.snapshot import utc_time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True, help="Private root containing both provider workspaces")
    parser.add_argument("--output", type=Path, required=True, help="New three-file display artifact directory")
    parser.add_argument("--clock", help="Optional explicit aware ISO publication/validation clock")
    parser.add_argument("--limit", type=int, default=500, help="Processed cards per provider, 1..500")
    parser.add_argument("--previous-package", type=Path, help="Previously validated own-site three-file display, for last-good recovery")
    parser.add_argument("--schema-version", choices=["arena-live-display-1.0", "arena-live-display-2.0"],
                        default="arena-live-display-2.0", help="V2 directory publication or explicit V1 compatibility")
    args = parser.parse_args()
    try:
        instant = utc_time(args.clock) if args.clock else None
        registry = LiveRegistry(args.workspace, clock=(lambda: instant) if instant else None)
        try:
            manifest = export_live_display(registry, args.output, now=instant, limit=args.limit,
                                           previous=args.previous_package, schema_version=args.schema_version)
        finally:
            registry.close()
    except (DisplayError, ValueError, OSError):
        parser.exit(1, "Display export failed; check the private source publications, aware clock, and fresh output path.\n")
    print(f"Verified processed display {manifest['display_version']}; no provider requests or forecasts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
