"""Read-only, provider-scoped current data with atomic immutable hot reload.

Fresh polling means a recent provider request, not an in-game event stream or
newly played match. This module never contacts providers or invokes a model.
Canonical packages are checksum-validated on a private bounded copy; requests
hold an immutable in-memory version while another request loads its successor.
"""

import hashlib
import json
import os
import re
import stat
import tempfile
import threading
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Annotated, Literal

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .current_publication import CalendarDataset, CurrentPublication, freeze, load_calendar, parse_publication, utc
from .snapshot import Manifest, snapshot_fingerprint, utc_time, validate_snapshot

Provider = Literal["football-data", "pandascore"]
ErrorCode = Literal[
    "awaiting_credentials", "quota_exhausted", "authentication_denied", "provider_rate_limited",
    "provider_unavailable", "provider_http_error", "network_error", "network_timeout",
    "invalid_provider_payload", "ingest_failed", "publication_failed", "cursor_commit_failed",
    "worker_interrupted", "clock_regression", "invalid_endpoint", "worker_error",
]
MatchStatus = Literal["scheduled", "running", "finished", "cancelled", "postponed"]
PROVIDERS = ("football-data", "pandascore")
STATUS_LIMIT = 64 * 1024
SNAPSHOT_LIMIT = 512_000_000
MAX_FILES = 256
MAX_MATCHES = 100_000
SNAPSHOT_NAME = re.compile(r"^snapshot-([a-f0-9]{16})-[a-f0-9]{8}$")


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class PollCounts(FrozenModel):
    attempted: int = Field(ge=0, le=10**12)
    succeeded: int = Field(ge=0, le=10**12)
    failed: int = Field(ge=0, le=10**12)
    awaiting_credentials: int = Field(ge=0, le=10**12)
    quota_limited: int = Field(ge=0, le=10**12)
    interrupted: int = Field(ge=0, le=10**12)


class LastPoll(FrozenModel):
    source_rows: int = Field(ge=0, le=1_000_000)
    changed_rows: int = Field(ge=0, le=1_000_000)
    unsupported_rows: int = Field(ge=0, le=1_000_000)
    requests: int = Field(ge=0, le=1_000_000)


class Capabilities(FrozenModel):
    tier: Literal["free"]
    update_mode: Literal["polled_rest"]
    scores_delayed: bool | None
    fixtures_and_results: bool
    in_game_round_feed: bool


class RequestBudget(FrozenModel):
    limit: int = Field(ge=1, le=1000)
    window_seconds: int = Field(ge=1, le=3600)
    used: int = Field(ge=0, le=1000)
    remaining: int = Field(ge=0, le=1000)


class SourceScope(FrozenModel):
    kind: Literal["competition_list", "match_phases"]
    competition_codes: list[Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9]{1,12}$")]] = Field(max_length=10)
    phases: list[Literal["past", "upcoming", "running"]] = Field(max_length=3)
    pages: int = Field(ge=1, le=20)


class LiveStatus(FrozenModel):
    schema_version: Literal["arena-live-status-1.0"]
    provider: Provider
    data_kind: Literal["api"]
    status: Literal["awaiting_credentials", "polling", "ready", "empty", "degraded", "quota_limited"]
    last_attempt_at: str | None
    last_success_at: str | None
    last_change_at: str | None
    poll_interval_seconds: int = Field(ge=30, le=86400)
    last_error_code: ErrorCode | None
    latest_snapshot: str | None = Field(pattern=r"^snapshot-[a-f0-9]{16}-[a-f0-9]{8}$")
    poll_counts: PollCounts
    last_poll: LastPoll
    capabilities: Capabilities
    request_budget: RequestBudget
    source_scope: SourceScope | None = None
    poll_id: int | None = Field(default=None, ge=1, le=2**63 - 1)

    @field_validator("last_attempt_at", "last_success_at", "last_change_at")
    @classmethod
    def timestamp(cls, value):
        return utc_time(value).isoformat(timespec="microseconds").replace("+00:00", "Z") if value is not None else None

    @model_validator(mode="after")
    def coherent(self):
        cap = self.capabilities
        if not cap.fixtures_and_results or cap.in_game_round_feed:
            raise ValueError("Unsupported provider capabilities")
        if cap.scores_delayed is not (True if self.provider == "football-data" else None):
            raise ValueError("Unexpected free provider score capability")
        budget = self.request_budget
        limit, window = (10, 60) if self.provider == "football-data" else (1000, 3600)
        if (not 1 <= budget.limit <= limit or budget.window_seconds != window
                or budget.used + budget.remaining != budget.limit):
            raise ValueError("Invalid provider request budget")
        if self.status in ("ready", "empty") and self.last_success_at is None:
            raise ValueError("Successful status needs a successful collection timestamp")
        if self.status == "ready" and self.latest_snapshot is None:
            raise ValueError("Ready status needs a snapshot")
        if self.latest_snapshot is not None and (self.last_success_at is None or self.last_change_at is None):
            raise ValueError("Published data needs successful collection and change timestamps")
        if self.last_change_at and self.last_success_at and self.last_change_at > self.last_success_at:
            raise ValueError("Publication change cannot follow successful collection")
        if self.source_scope is not None:
            scope = self.source_scope
            if (len(set(scope.competition_codes)) != len(scope.competition_codes)
                    or len(set(scope.phases)) != len(scope.phases)):
                raise ValueError("Duplicate source scope")
            if (self.provider == "football-data" and
                    (scope.kind != "competition_list" or not scope.competition_codes or scope.phases)):
                raise ValueError("Invalid football polling scope")
            if (self.provider == "pandascore" and
                    (scope.kind != "match_phases" or scope.competition_codes or not scope.phases)):
                raise ValueError("Invalid series polling scope")
        return self


class LiveMatch(FrozenModel):
    event_id: str = Field(min_length=1, max_length=180)
    match_id: str = Field(min_length=1, max_length=120)
    provider: Provider
    sport: Literal["football", "valorant"]
    competition: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=1)
    team_a_id: str = Field(min_length=1, max_length=180)
    team_a: str = Field(min_length=1, max_length=100)
    team_b_id: str = Field(min_length=1, max_length=180)
    team_b: str = Field(min_length=1, max_length=100)
    start_time: str
    observed_at: str
    completed_at: str | None
    status: MatchStatus
    score_a: int | None = Field(ge=0, le=50)
    score_b: int | None = Field(ge=0, le=50)
    best_of: int = Field(ge=1, le=9)

    @field_validator("start_time", "observed_at", "completed_at")
    @classmethod
    def timestamp(cls, value):
        return utc_time(value).isoformat(timespec="microseconds").replace("+00:00", "Z") if value is not None else None

    @field_validator("event_id", "match_id", "competition", "team_a_id", "team_a", "team_b_id", "team_b")
    @classmethod
    def text(cls, value):
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Control characters are not accepted")
        return value

    @model_validator(mode="after")
    def coherent(self):
        if self.team_a_id == self.team_b_id:
            raise ValueError("Teams must differ")
        if self.sport != ("football" if self.provider == "football-data" else "valorant"):
            raise ValueError("Provider sport mismatch")
        if self.status == "finished":
            if (self.score_a is None or self.score_b is None or self.completed_at is None
                    or not self.start_time < self.completed_at <= self.observed_at):
                raise ValueError("Invalid result availability")
            if self.sport == "valorant":
                needed = self.best_of // 2 + 1
                if (self.best_of % 2 == 0 or max(self.score_a, self.score_b) != needed
                        or min(self.score_a, self.score_b) >= needed):
                    raise ValueError("Invalid completed series score")
        elif self.completed_at is not None:
            raise ValueError("Only completed results have completion times")
        return self


class PublicationError(ValueError):
    """Sanitized diagnostic category; never contains a source payload/token."""


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise PublicationError("invalid_json")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(PublicationError("invalid_json")))


def _safe(path: Path):
    # Windows directory junctions are reparse points too, not always symlinks.
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 1024:
            raise PublicationError("unsafe_path")


def _read(path: Path, limit: int):
    _safe(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        raise PublicationError("size_limit")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise PublicationError("unsafe_path")
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise PublicationError("size_limit")
    return raw


@dataclass(frozen=True)
class Dataset:
    manifest: MappingProxyType
    fingerprint: str
    table: pa.Table
    by_id: MappingProxyType


@dataclass(frozen=True)
class Capture:
    provider: str
    dataset: Dataset | None
    status: LiveStatus | None
    state: str
    error: str | None
    now: datetime
    serving_last_good: bool
    calendar: CalendarDataset | None = None
    publication: CurrentPublication | None = None
    selection_mode: Literal["paired", "legacy"] = "legacy"
    status_alignment: Literal["same_collection", "newer_attempt", "different_collection", "unavailable"] = "unavailable"


@dataclass
class Entry:
    dataset: Dataset | None = None
    status: LiveStatus | None = None
    signature: str | None = None
    failed_signature: str | None = None
    retry_at: datetime | None = None
    failure: str | None = None
    calendar: CalendarDataset | None = None
    publication: CurrentPublication | None = None
    publication_raw_hash: str | None = None
    paired_seen: bool = False


class LiveRegistry:
    """Read-only directory registry; one immutable dataset per request/provider."""

    def __init__(self, root: Path, *, clock=None):
        self.root = Path(root).absolute()
        if ".." in self.root.parts:
            raise ValueError("Live root must not contain traversal")
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._entries = {provider: Entry() for provider in PROVIDERS}
        self._lock = threading.RLock()

    def close(self):
        with self._lock:
            self._entries = {provider: Entry() for provider in PROVIDERS}

    def _now(self):
        value = self.clock()
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise ValueError("Live registry clock must return an aware datetime")
        return value.astimezone(timezone.utc)

    def _inventory(self, directory, *, content=False):
        _safe(directory)
        if not directory.is_dir():
            raise PublicationError("snapshot_missing")
        signature, files, total = [], {}, 0
        for index, item in enumerate(directory.rglob("*")):
            if index >= 1024:
                raise PublicationError("size_limit")
            _safe(item)
            info = item.lstat()
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                raise PublicationError("unsafe_path")
            if stat.S_ISREG(info.st_mode):
                if len(files) >= MAX_FILES:
                    raise PublicationError("size_limit")
                relative = item.relative_to(directory).as_posix()
                files[relative] = item
                total += info.st_size
                if total > SNAPSHOT_LIMIT:
                    raise PublicationError("size_limit")
                digest = None
                if content:
                    # Content signatures also detect replacement with preserved
                    # size/mtime. Stream bounded files without allocating a copy.
                    digest = hashlib.sha256()
                    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
                    with os.fdopen(os.open(item, flags), "rb") as stream:
                        opened = os.fstat(stream.fileno())
                        if (not stat.S_ISREG(opened.st_mode)
                                or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino)):
                            raise PublicationError("unsafe_path")
                        remaining = info.st_size
                        while chunk := stream.read(min(1024 * 1024, remaining + 1)):
                            remaining -= len(chunk)
                            if remaining < 0:
                                raise PublicationError("size_limit")
                            digest.update(chunk)
                        if remaining:
                            raise PublicationError("snapshot_changed_during_read")
                signature.append((relative, info.st_size,
                                  digest.hexdigest() if digest else (info.st_mtime_ns, info.st_ino)))
        return files, hashlib.sha256(json.dumps(sorted(signature)).encode()).hexdigest()

    def _load(self, directory, files, provider, now, expected_manifest_sha256=None):
        raw_manifest = _read(directory / "manifest.json", 2_000_000)
        if expected_manifest_sha256 is not None and hashlib.sha256(raw_manifest).hexdigest() != expected_manifest_sha256:
            raise PublicationError("snapshot_manifest_mismatch")
        manifest = Manifest.model_validate(_json(raw_manifest)).model_dump()
        if manifest["data_kind"] != "api" or manifest["providers"] != [provider]:
            raise PublicationError("snapshot_provider_mismatch")
        if manifest["dataset_version"] != SNAPSHOT_NAME.fullmatch(directory.name).group(1):
            raise PublicationError("snapshot_version_mismatch")
        cutoff, generated = utc_time(manifest["as_of"]), utc_time(manifest["generated_at"])
        if not cutoff <= generated <= now:
            raise PublicationError("future_timestamp")
        if set(files) != {"manifest.json", *manifest["files"]}:
            raise PublicationError("snapshot_inventory_mismatch")
        # Copy verified exact bytes once. Snapshot's established validator reads
        # only this private, stable tree; subsequent requests use Arrow memory.
        with tempfile.TemporaryDirectory(prefix="arena-live-verified-") as temporary:
            stage = Path(temporary)
            (stage / "manifest.json").write_bytes(raw_manifest)
            total = len(raw_manifest)
            for name, expected in manifest["files"].items():
                pure = PurePosixPath(name)
                if (pure.is_absolute() or ".." in pure.parts or "\\" in name or ":" in name
                        or str(pure) != name or len(pure.parts) > 4):
                    raise PublicationError("unsafe_path")
                file_limit = min(SNAPSHOT_LIMIT - total, 2_000_000) if name.endswith(".json") else SNAPSHOT_LIMIT - total
                raw = _read(files[name], file_limit)
                total += len(raw)
                if hashlib.sha256(raw).hexdigest() != expected:
                    raise PublicationError("snapshot_checksum_mismatch")
                target = stage.joinpath(*pure.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
            table_path = stage / "gold/matches.parquet"
            metadata = pq.ParquetFile(table_path).metadata
            if (metadata.num_rows > MAX_MATCHES
                    or sum(metadata.row_group(i).total_byte_size for i in range(metadata.num_row_groups)) > SNAPSHOT_LIMIT):
                raise PublicationError("size_limit")
            checked = validate_snapshot(stage)
            table = pq.read_table(table_path)
            models, ids = [], set()
            for batch in table.to_batches(max_chunksize=4096):
                for raw in batch.to_pylist():
                    row = LiveMatch.model_validate(raw)
                    if row.provider != provider or utc_time(row.observed_at) > cutoff:
                        raise PublicationError("snapshot_provider_or_cutoff_mismatch")
                    if row.match_id in ids:
                        raise PublicationError("duplicate_match_identity")
                    ids.add(row.match_id)
                    models.append(row)
            # Explicit schema persists even for an empty canonical table.
            normalized = pa.Table.from_pylist([row.model_dump() for row in models], schema=table.schema)
        return Dataset(freeze(checked), snapshot_fingerprint(checked), normalized,
                       MappingProxyType({row.match_id: row for row in models}))

    @staticmethod
    def _alignment(status, publication):
        if status is None or publication is None:
            return "unavailable"
        collected = utc(publication.collected_at)
        selected = utc(publication.selected_at)
        success = utc_time(status.last_success_at) if status.last_success_at else None
        attempt = utc_time(status.last_attempt_at) if status.last_attempt_at else None
        if (status.source_scope is not None
                and status.source_scope.model_dump() != publication.source_scope.model_dump(mode="json")):
            return "different_collection"
        if (status.latest_snapshot is not None and publication.canonical is not None
                and status.latest_snapshot != publication.canonical.basename):
            return "different_collection"
        if attempt is not None and attempt > selected:
            return ("different_collection" if status.status in ("ready", "empty")
                    and success is not None and success >= attempt else "newer_attempt")
        # Clocks can coincide across distinct polls. Older status contracts lack
        # the durable poll identity needed to assert same_collection.
        if status.poll_id is None:
            return "unavailable"
        if (status.poll_id == publication.poll_id and success is not None and success >= collected
                and status.source_scope is not None
                and status.source_scope.model_dump() == publication.source_scope.model_dump(mode="json")):
            return "same_collection"
        return "different_collection"

    def _paired_capture(self, provider, entry, body):
        """Commit a fully validated pair to one immutable per-request pointer."""
        status, status_error = entry.status, None
        try:
            status_body = _read(self.root / provider / "snapshots/LIVE_STATUS.json", STATUS_LIMIT)
            now = self._now()
            replacement = LiveStatus.model_validate(_json(status_body))
            if replacement.provider != provider or any(utc_time(value) > now for value in
                    (replacement.last_attempt_at, replacement.last_success_at, replacement.last_change_at) if value):
                raise PublicationError("invalid_status")
            status = replacement
            entry.status = status
        except FileNotFoundError:
            now, status_error = self._now(), "status_missing"
        except Exception:
            now, status_error = self._now(), "invalid_status"
        try:
            publication = parse_publication(body, provider, now)
            raw_hash = hashlib.sha256(body).hexdigest()
            previous = entry.publication
            if previous and (publication.poll_id < previous.poll_id
                    or publication.poll_id == previous.poll_id and publication.fingerprint != previous.fingerprint
                    or utc(publication.collected_at) < utc(previous.collected_at)
                    or utc(publication.selected_at) < utc(previous.selected_at)):
                raise PublicationError("publication_regression")
            files, canonical_signature = ({}, "none")
            if publication.canonical:
                canonical_directory = self.root / provider / "snapshots" / publication.canonical.basename
                files, canonical_signature = self._inventory(canonical_directory, content=True)
            calendar_signature = "none"
            if publication.calendar:
                calendar_directory = self.root / provider / "calendars" / publication.calendar.basename
                _, calendar_signature = self._inventory(calendar_directory, content=True)
            signature = hashlib.sha256((raw_hash + canonical_signature + calendar_signature).encode()).hexdigest()
            if signature != entry.signature:
                dataset = (self._load(canonical_directory, files, provider, now,
                                     publication.canonical.manifest_sha256) if publication.canonical else None)
                calendar = (load_calendar(calendar_directory, publication.calendar, now,
                                          canonical_ids=dataset.by_id if dataset else ())
                            if publication.calendar else None)
                for manifest in (dataset.manifest if dataset else None, calendar.manifest if calendar else None):
                    if manifest and (utc_time(manifest["as_of"]) > utc(publication.collected_at)
                                     or utc_time(manifest["generated_at"]) > utc(publication.selected_at)):
                        raise PublicationError("publication_clock_mismatch")
                if calendar and calendar.manifest["source_scope"] != freeze(publication.source_scope.model_dump(mode="json")):
                    raise PublicationError("publication_scope_mismatch")
                # No state is installed until both complete members and links pass.
                entry.dataset, entry.calendar = dataset, calendar
                entry.signature = signature
                entry.failed_signature = entry.retry_at = entry.failure = None
                entry.publication, entry.publication_raw_hash = publication, raw_hash
            selected = entry.publication
            alignment = self._alignment(status, selected)
            # The selector is coverage authority even before final status recovery.
            failure_status = (status and alignment == "newer_attempt"
                              and status.status in ("degraded", "quota_limited", "awaiting_credentials"))
            state = status.status if failure_status else "ready" if entry.dataset or entry.calendar else "empty"
            return Capture(provider, entry.dataset, status, state, status_error, now, bool(failure_status),
                           entry.calendar, selected, "paired", alignment)
        except Exception:
            entry.failure = "invalid_paired_publication"
            return Capture(provider, entry.dataset, status, "invalid_publication", entry.failure, now,
                           entry.publication is not None or entry.dataset is not None,
                           entry.calendar, entry.publication, "paired",
                           self._alignment(status, entry.publication) if entry.publication else "unavailable")

    def capture(self, provider: Provider) -> Capture:
        if provider not in PROVIDERS:
            raise ValueError("Unsupported live provider")
        with self._lock:
            entry = self._entries[provider]
            try:
                selector = _read(self.root / provider / "snapshots/CURRENT_PUBLICATION.json", STATUS_LIMIT)
            except FileNotFoundError:
                if entry.paired_seen:
                    return Capture(provider, entry.dataset, entry.status, "invalid_publication",
                                   "paired_selector_missing", self._now(),
                                   entry.publication is not None or entry.dataset is not None, entry.calendar,
                                   entry.publication, "paired", self._alignment(entry.status, entry.publication))
            except Exception:
                entry.paired_seen = True
                return Capture(provider, entry.dataset, entry.status, "invalid_publication",
                               "invalid_paired_publication", self._now(),
                               entry.publication is not None or entry.dataset is not None,
                               entry.calendar, entry.publication, "paired",
                               self._alignment(entry.status, entry.publication) if entry.publication else "unavailable")
            else:
                entry.paired_seen = True
                return self._paired_capture(provider, entry, selector)
            status_read = False
            now = None
            try:
                directory = self.root / provider / "snapshots"
                raw = _read(directory / "LIVE_STATUS.json", STATUS_LIMIT)
                status_read = True
                # A publication can advance while this request waits for the
                # lock or reads its bounded status bytes. Validate against the
                # capture time after that read, never an earlier request clock.
                now = self._now()
                status = LiveStatus.model_validate(_json(raw))
                if status.provider != provider:
                    raise PublicationError("status_provider_mismatch")
                if any(utc_time(value) > now for value in
                       (status.last_attempt_at, status.last_success_at, status.last_change_at) if value):
                    raise PublicationError("future_timestamp")
                if status.latest_snapshot is None:
                    entry.status = status
                    state = status.status if entry.dataset is None else "degraded"
                    return Capture(provider, entry.dataset, status, state, None, now, entry.dataset is not None)
                snapshot_dir = directory / status.latest_snapshot
                files, content_signature = self._inventory(snapshot_dir)
                signature = hashlib.sha256((status.latest_snapshot + content_signature).encode()).hexdigest()
                if signature != entry.signature:
                    if (signature == entry.failed_signature and entry.retry_at is not None and now < entry.retry_at):
                        return Capture(provider, entry.dataset, entry.status, "invalid_publication", entry.failure,
                                       now, entry.dataset is not None)
                    try:
                        replacement = self._load(snapshot_dir, files, provider, now)
                    except Exception:
                        entry.failed_signature = signature
                        entry.retry_at = now + timedelta(seconds=min(status.poll_interval_seconds, 60))
                        raise
                    entry.dataset, entry.signature = replacement, signature
                    entry.failed_signature = entry.retry_at = entry.failure = None
                entry.status = status
                return Capture(provider, entry.dataset, status, status.status, None, now,
                               status.status in ("degraded", "quota_limited", "awaiting_credentials"))
            except FileNotFoundError:
                now = now or self._now()
                state, code = ("invalid_publication", "snapshot_missing") if status_read else ("not_connected", "status_missing")
                return Capture(provider, entry.dataset, entry.status, state, code, now,
                               entry.dataset is not None)
            except Exception as error:
                now = now or self._now()
                # Do not leak validation bodies, exception strings or paths.
                code = str(error) if isinstance(error, PublicationError) else "invalid_publication"
                entry.failure = code
                return Capture(provider, entry.dataset, entry.status, "invalid_publication", code, now,
                               entry.dataset is not None)

    @staticmethod
    def _envelope(capture: Capture, **extra):
        status, dataset, publication, calendar = capture.status, capture.dataset, capture.publication, capture.calendar
        manifest = dataset.manifest if dataset else None
        success_at = publication.collected_at if publication else status.last_success_at if status else None
        poll_age = ((capture.now - utc_time(success_at)).total_seconds() if success_at else None)
        threshold = max(120, 2 * status.poll_interval_seconds) if status else 120 if publication else None
        stale = (poll_age is None or threshold is None or poll_age > threshold
                 or capture.state in ("invalid_publication", "not_connected")
                 or publication is not None and capture.serving_last_good)
        state = "stale" if stale and capture.state == "ready" else capture.state
        return dict(provider=capture.provider, data_kind="api", status=state,
                    producer_status=status.status if status else None, snapshot_available=dataset is not None,
                    dataset_version=manifest["dataset_version"] if manifest else None,
                    snapshot_fingerprint=dataset.fingerprint if dataset else None,
                    as_of=manifest["as_of"] if manifest else None, cutoff=manifest["as_of"] if manifest else None,
                    generated_at=manifest["generated_at"] if manifest else None,
                    last_attempt_at=status.last_attempt_at if status else None,
                    last_success_at=success_at,
                    last_change_at=status.last_change_at if status else None,
                    status_last_success_at=status.last_success_at if status else None,
                    status_last_change_at=status.last_change_at if status else None,
                    collected_at=publication.collected_at if publication else None,
                    selected_at=publication.selected_at if publication else None,
                    publication_fingerprint=publication.fingerprint if publication else None,
                    poll_id=publication.poll_id if publication else None,
                    selection_mode=capture.selection_mode, status_alignment=capture.status_alignment,
                    calendar_available=calendar is not None,
                    calendar_version=calendar.manifest["dataset_version"] if calendar else None,
                    calendar_fingerprint=calendar.calendar_fingerprint if calendar else None,
                    calendar_facts_version=calendar.facts_version if calendar else None,
                    calendar_observation_cutoff=calendar.manifest["as_of"] if calendar else None,
                    calendar_generated_at=calendar.manifest["generated_at"] if calendar else None,
                    calendar_unavailable_reason=(None if calendar else "legacy_status_only" if
                                                 capture.selection_mode == "legacy" else "no_verified_calendar"),
                    poll_interval_seconds=status.poll_interval_seconds if status else None,
                    poll_age_seconds=poll_age, stale_after_seconds=threshold, stale=stale,
                    serving_last_good=capture.serving_last_good, publication_error_code=capture.error,
                    last_error_code=status.last_error_code if status else None,
                    poll_counts=status.poll_counts.model_dump() if status else None,
                    last_poll=status.last_poll.model_dump() if status else None,
                    capabilities=status.capabilities.model_dump() if status else None,
                    request_budget=status.request_budget.model_dump() if status else None,
                    source_scope=publication.source_scope.model_dump(mode="json") if publication else
                                 status.source_scope.model_dump() if status and status.source_scope else None,
                    attempt_scope=status.source_scope.model_dump() if status and status.source_scope else None,
                    freshness_scope="selected_completed_collection" if publication else
                                    "declared_poll_scope" if status and status.source_scope else "unknown_poll_scope",
                    coverage_scope="Retained canonical records; a fresh poll does not imply every stored row changed.",
                    update_mode="polled_rest", in_game_round_feed=False, predictions_available=False,
                    **extra)

    def provider_health(self, provider: Provider):
        return self._envelope(self.capture(provider))

    def health(self):
        return dict(providers=[self.provider_health(p) for p in PROVIDERS], update_mode="polled_rest",
                    in_game_round_feed=False, predictions_available=False)

    def updates(self):
        health = self.health()
        return dict(**health, revision_vector={p["provider"]: p["snapshot_fingerprint"] for p in health["providers"]},
                    transport="client_polling")

    def matches(self, provider: Provider, *, sport=None, status=None, competition=None, team_id=None,
                search=None, date_from=None, date_to=None, order="desc", limit=25, offset=0):
        if type(limit) is not int or type(offset) is not int or not 1 <= limit <= 100 or not 0 <= offset <= 100_000:
            raise ValueError("Use limit1..100 and offset0..100000")
        if order not in ("asc", "desc") or sport not in (None, "football", "valorant"):
            raise ValueError("Invalid sport or order")
        if status not in (None, "scheduled", "running", "finished", "cancelled", "postponed"):
            raise ValueError("Invalid match status")
        for value, bound in ((competition, 120), (team_id, 180), (search, 100)):
            if value is not None and (not isinstance(value, str) or len(value) > bound):
                raise ValueError("Invalid bounded filter")
        begin = date.fromisoformat(date_from) if isinstance(date_from, str) else date_from
        end = date.fromisoformat(date_to) if isinstance(date_to, str) else date_to
        if begin and end and not timedelta(0) <= end - begin <= timedelta(days=366):
            raise ValueError("Date range must be ordered and span at most366 days")
        try:
            exclusive_end = datetime.combine(end + timedelta(days=1), time.min, timezone.utc) if end else None
        except (OverflowError, TypeError) as error:
            raise ValueError("Invalid upper date filter") from error
        capture = self.capture(provider)
        if capture.dataset is None:
            return self._envelope(capture, rows=[], total=0, limit=limit, offset=offset)
        conditions, parameters = [], []
        for field, value in (("sport", sport), ("status", status), ("competition", competition)):
            if value is not None:
                conditions.append(f"{field}=?")
                parameters.append(value)
        if team_id:
            conditions.append("(team_a_id=? OR team_b_id=?)")
            parameters.extend([team_id, team_id])
        if search:
            conditions.append("contains(lower(team_a||' '||team_b||' '||competition||' '||match_id),lower(?))")
            parameters.append(search)
        if begin:
            conditions.append("CAST(start_time AS TIMESTAMPTZ)>=?")
            parameters.append(datetime.combine(begin, time.min, timezone.utc))
        if end:
            conditions.append("CAST(start_time AS TIMESTAMPTZ)<?")
            parameters.append(exclusive_end)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        with duckdb.connect(":memory:") as connection:
            connection.register("current_matches", capture.dataset.table)
            total = connection.execute("SELECT COUNT(*) FROM current_matches" + where, parameters).fetchone()[0]
            result = connection.execute("SELECT * FROM current_matches" + where +
                f" ORDER BY CAST(start_time AS TIMESTAMPTZ) {order.upper()},match_id LIMIT ? OFFSET ?",
                parameters + [limit, offset])
            names = [field[0] for field in result.description]
            rows = [dict(zip(names, row)) for row in result.fetchall()]
        return self._envelope(capture, rows=rows, total=total, limit=limit, offset=offset)

    def match(self, provider: Provider, match_id: str):
        if not isinstance(match_id, str) or not 1 <= len(match_id) <= 120:
            raise ValueError("Invalid match ID")
        capture = self.capture(provider)
        match = capture.dataset.by_id.get(match_id) if capture.dataset else None
        return self._envelope(capture, match=match.model_dump() if match else None)


def create_live_router(registry: LiveRegistry):
    router = APIRouter(prefix="/live", tags=["current provider data"])

    @router.get("/health")
    def health(provider: Provider | None = None):
        return registry.provider_health(provider) if provider else registry.health()

    @router.get("/updates")
    def updates():
        return registry.updates()

    @router.get("/matches")
    def matches(provider: Provider, sport: Literal["football", "valorant"] | None = None,
                status: MatchStatus | None = None, competition: str | None = Query(None, max_length=120),
                team_id: str | None = Query(None, max_length=180), search: str | None = Query(None, max_length=100),
                date_from: date | None = None, date_to: date | None = None,
                order: Literal["asc", "desc"] = "desc", limit: int = Query(25, ge=1, le=100),
                offset: int = Query(0, ge=0, le=100_000)):
        try:
            return registry.matches(provider, sport=sport, status=status, competition=competition,
                                    team_id=team_id, search=search, date_from=date_from, date_to=date_to,
                                    order=order, limit=limit, offset=offset)
        except ValueError:
            return JSONResponse({"detail": "Invalid bounded current-data filters"}, status_code=400)

    @router.get("/matches/{match_id}")
    def match(match_id: str, provider: Provider):
        try:
            result = registry.match(provider, match_id)
        except ValueError:
            return JSONResponse({"detail": "Invalid current-data match ID"}, status_code=400)
        if result["match"] is None:
            result["detail"] = "No verified dataset available" if not result["snapshot_available"] else "Match not found"
            return JSONResponse(result, status_code=503 if not result["snapshot_available"] else 404)
        return result

    return router
