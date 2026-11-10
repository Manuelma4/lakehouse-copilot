"""Reject incomplete/tampered snapshots before any query or prompt uses them."""

import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone

import pyarrow.parquet as pq
from pydantic import BaseModel, ConfigDict, Field

REQUIRED = {"catalog.json", "metrics.json", "lineage.json", "quality.json", "incidents.json",
            "predictions.json", "model_report.json", "gold/matches.parquet", "gold/team_stats.parquet"}


class SnapshotError(ValueError):
    pass


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str
    dataset_version: str = Field(pattern=r"^[a-f0-9]{16}$")
    producer_version: str
    generated_at: str
    as_of: str
    data_kind: str
    providers: list[str]
    files: dict[str, str]


def utc_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise SnapshotError("Snapshot timestamps must be timezone-aware")
    return parsed.astimezone(timezone.utc)


def snapshot_fingerprint(manifest: dict) -> str:
    # Source event identity and export/package identity serve different purposes.
    payload = {key: manifest[key] for key in ("schema_version", "producer_version", "files")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_snapshot(root: Path) -> dict:
    root = Path(root).resolve(strict=True)
    try:
        manifest_path = root / "manifest.json"
        if manifest_path.is_symlink() or manifest_path.stat().st_size > 2_000_000:
            raise SnapshotError("Unsafe manifest")
        manifest = Manifest.model_validate_json(manifest_path.read_text(encoding="utf-8")).model_dump()
        if manifest["schema_version"] != "2.0" or manifest["data_kind"] not in ("synthetic", "api"):
            raise SnapshotError("Unsupported snapshot contract or data kind")
        for key in ("generated_at", "as_of"):
            utc_time(manifest[key])
        if (manifest["data_kind"] == "synthetic" and manifest["providers"] != ["synthetic"]
            or manifest["data_kind"] == "api" and (not manifest["providers"]
                or not set(manifest["providers"]) <= {"football-data", "pandascore"})):
            raise SnapshotError("Provider provenance disagrees with data kind")
        files = manifest["files"]
        if not REQUIRED <= set(files) or not any(x.startswith("docs/") and x.endswith(".md") for x in files):
            raise SnapshotError("Required snapshot payload is missing")
        actual = set()
        for item in root.rglob("*"):
            if item.is_symlink():
                raise SnapshotError("Symlinks are forbidden")
            if item.is_file() and item != manifest_path:
                actual.add(item.relative_to(root).as_posix())
        if actual != set(files):
            raise SnapshotError("Snapshot has missing or extra files")
        total = 0
        for name, expected in files.items():
            pure = PurePosixPath(name)
            if (pure.is_absolute() or ".." in pure.parts or "\\" in name or ":" in name
                or str(pure) != name or len(expected) != 64):
                raise SnapshotError("Unsafe manifest path or checksum")
            item = root.joinpath(*pure.parts)
            if not item.resolve().is_relative_to(root):
                raise SnapshotError("Snapshot path escapes root")
            total += item.stat().st_size
            if total > 512_000_000:
                raise SnapshotError("Snapshot exceeds the local-demo size limit")
            if hashlib.sha256(item.read_bytes()).hexdigest() != expected:
                raise SnapshotError(f"Checksum mismatch: {name}")
        team_fields = ("team_a_id", "team_a", "team_b_id", "team_b")
        for table, columns in {
            "matches": {"match_id", "sport", *team_fields, "status", "start_time"},
            "team_stats": {"sport", "team_id", "team_name", "matches", "wins", "draws", "losses", "win_rate"},
        }.items():
            if not columns <= set(pq.read_schema(root / f"gold/{table}.parquet").names):
                raise SnapshotError(f"Invalid {table} table schema")
        predictions = json.loads((root / "predictions.json").read_text(encoding="utf-8"))
        if not isinstance(predictions, list):
            raise SnapshotError("Predictions must be an array")
        rows = pq.read_table(root / "gold/matches.parquet",
                   columns=["match_id", "sport", *team_fields, "status", "start_time"]).to_pylist()
        matches = {}
        for match in rows:
            if (not isinstance(match["match_id"], str) or match["sport"] not in ("football", "valorant")
                or match["status"] not in ("scheduled", "running", "finished", "cancelled", "postponed")):
                raise SnapshotError("Invalid canonical match identity, sport or status")
            if match["match_id"] in matches:
                raise SnapshotError("Duplicate canonical match identity")
            if (any(not isinstance(match[field], str) or not match[field] for field in team_fields)
                or match["team_a_id"] == match["team_b_id"]):
                raise SnapshotError("Invalid canonical match teams")
            utc_time(match["start_time"])
            matches[match["match_id"]] = match
        prediction_ids = set()
        for prediction in predictions:
            match_id = prediction["match_id"]
            if match_id in prediction_ids:
                raise SnapshotError("Duplicate prediction for canonical match")
            if prediction["sport"] not in ("football", "valorant"):
                raise SnapshotError("Prediction sport is unsupported")
            probs = prediction["probabilities"]
            classes = {"a", "b", "draw"} if prediction["sport"] == "football" else {"a", "b"}
            if (set(probs) != classes or any(type(p) not in (int, float) or not 0 <= p <= 1 for p in probs.values())
                or not math.isclose(sum(probs.values()), 1.0, abs_tol=1e-6)
                or prediction["data_kind"] != manifest["data_kind"]):
                raise SnapshotError("Prediction contract mismatch")
            match = matches.get(match_id)
            if (not match or match["sport"] != prediction["sport"] or match["status"] != "scheduled"
                or utc_time(prediction["as_of"]) != utc_time(manifest["as_of"])
                or utc_time(prediction["as_of"]) >= utc_time(match["start_time"])):
                raise SnapshotError("Prediction is not consistent with its match or observation cutoff")
            if ((prediction.get("team_a"), prediction.get("team_b")) != (match["team_a"], match["team_b"])
                or utc_time(prediction["start_time"]) != utc_time(match["start_time"])):
                raise SnapshotError("Prediction teams or kickoff do not match the canonical match")
            prediction_ids.add(match_id)
        return manifest
    except SnapshotError:
        raise
    except (ValueError, KeyError, OSError, TypeError) as error:
        raise SnapshotError("Malformed snapshot payload") from error


def default_fixture() -> Path:
    return Path(__file__).parent / "showcase"
