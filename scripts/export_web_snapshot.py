"""Build the public web fixture from a checksum-verified original snapshot."""

import argparse
from pathlib import Path

from arena_copilot.agent import Copilot
from arena_copilot.analytics import write_public_snapshot
from arena_copilot.snapshot import default_fixture

parser = argparse.ArgumentParser()
parser.add_argument("--snapshot", type=Path, default=default_fixture())
parser.add_argument("--output", type=Path, default=Path("web/public/snapshot.json"))
args = parser.parse_args()
agent = Copilot(args.snapshot, Path("data/web-export"))
payload = write_public_snapshot(agent, args.output)
print(f"Validated synthetic web snapshot: {len(payload['matches'])} matches, {len(payload['teams'])} teams")
