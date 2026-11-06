"""Export the verified CC0 research package separately from the synthetic demo."""

import argparse
from pathlib import Path

from arena_copilot.openfootball import default_research, write_public_research

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--snapshot", type=Path, default=default_research())
parser.add_argument("--output", type=Path, default=Path("web/public/open-football.json"))
args = parser.parse_args()
payload = write_public_research(args.snapshot, args.output)
print(f"Validated CC0 research: {len(payload['matches'])} matches, {len(payload['competitions'])} source editions")
