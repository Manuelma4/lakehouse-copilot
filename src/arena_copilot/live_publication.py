"""Small, processed own-site match cards from two verified private captures.

This is a display contract, not a canonical/provider database export. Provider
requests, credentials, forecasts, raw archives, and model traces are out of scope.
"""

import hashlib
import json
import os
import shutil
import stat
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .live import LiveRegistry, SourceScope
from .snapshot import utc_time

SCHEMA = "arena-live-display-1.0"
PROVIDERS = ("football-data", "pandascore")
FILES = tuple(f"{provider}.json" for provider in PROVIDERS)
MAX_CARDS = 500
MAX_FILE_BYTES = 2 * 1024 * 1024
LABELS = {"scheduled": "Scheduled", "running": "In progress", "finished": "Finished",
          "cancelled": "Cancelled", "postponed": "Postponed"}
ATTRIBUTION = {
    "football-data": dict(text="Football data provided by the Football-Data.org API",
                          url="https://www.football-data.org/", terms_url="https://www.football-data.org/client/register"),
    "pandascore": dict(text="Source: PandaScore", url="https://www.pandascore.co/",
                       terms_url="https://www.pandascore.co/terms-and-condition"),
}
LICENSE_NOTE = "Provider-derived processed cards for the account owner's informational website; not MIT, CC0, or a reusable provider data feed."
ERROR_CODES = {
    "awaiting_credentials", "quota_exhausted", "authentication_denied", "provider_rate_limited",
    "provider_unavailable", "provider_http_error", "network_error", "network_timeout", "invalid_provider_payload",
    "ingest_failed", "publication_failed", "cursor_commit_failed", "worker_interrupted", "clock_regression",
    "invalid_endpoint", "worker_error", "invalid_publication", "status_missing", "snapshot_missing", "invalid_json",
    "unsafe_path", "size_limit", "snapshot_provider_mismatch", "snapshot_version_mismatch", "future_timestamp",
    "snapshot_inventory_mismatch", "snapshot_checksum_mismatch", "snapshot_provider_or_cutoff_mismatch",
    "duplicate_match_identity", "status_provider_mismatch",
}
Provider = Literal["football-data", "pandascore"]
Hex16 = Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]
Hex64 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Stamp = Annotated[str, Field(max_length=100)]
Text = Annotated[str, Field(min_length=1, max_length=120)]
DisplayID = Annotated[str, Field(pattern=r"^(football-data|pandascore)-[0-9a-f]{16}$")]


class DisplayError(ValueError):
    """Sanitized publication failure with no payload or credentials."""


def _stamp(value: str) -> str:
    return utc_time(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class TeamCard(Strict):
    display_id: DisplayID
    label: Text

    @field_validator("label")
    @classmethod
    def label_clean(cls, value):
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Invalid label")
        return value


class Card(Strict):
    display_id: DisplayID
    sport: Literal["football", "valorant"]
    competition_label: Text
    team_a: TeamCard
    team_b: TeamCard
    kickoff_utc: Stamp
    day_utc: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    kickoff_label: Annotated[str, Field(pattern=r"^\d{2}:\d{2} UTC$")]
    status_label: Literal["Scheduled", "In progress", "Finished", "Cancelled", "Postponed"]
    series_format: Annotated[str, Field(pattern=r"^(Single match|Best of [1-9])$")]
    score_label: Annotated[str, Field(pattern=r"^([0-9]|[1-4][0-9]|50)–([0-9]|[1-4][0-9]|50)$")] | None
    result_state: Literal["unavailable", "provisional", "final"]
    winning_side: Literal["team_a", "team_b", "draw"] | None

    _kickoff = field_validator("kickoff_utc")(_stamp)
    _competition = field_validator("competition_label")(TeamCard.label_clean.__func__)


class Health(Strict):
    state: Literal["not_connected", "invalid_publication", "awaiting_credentials", "polling", "ready", "empty",
                   "degraded", "quota_limited", "stale"]
    producer_state: Literal["awaiting_credentials", "polling", "ready", "empty", "degraded", "quota_limited"] | None
    stale: bool
    serving_last_good: bool
    last_attempt_at: Stamp | None
    last_success_at: Stamp | None
    last_change_at: Stamp | None
    poll_interval_seconds: Annotated[int, Field(ge=30, le=86400)] | None
    stale_after_seconds: Annotated[int, Field(ge=120, le=172800)] | None
    source_scope: SourceScope | None
    attempt_scope: SourceScope | None
    freshness_scope: Literal["declared_poll_scope", "unknown_poll_scope"]
    error_code: Annotated[str, Field(min_length=1, max_length=60)] | None
    scores_delayed: bool | None
    update_mode: Literal["polled_rest"] = "polled_rest"
    in_game_round_feed: Literal[False] = False

    @field_validator("last_attempt_at", "last_success_at", "last_change_at")
    @classmethod
    def timestamps(cls, value):
        return _stamp(value) if value is not None else None

    @field_validator("error_code")
    @classmethod
    def error(cls, value):
        if value is not None and value not in ERROR_CODES:
            raise ValueError("Unknown diagnostic code")
        return value


class CanonicalIdentity(Strict):
    dataset_version: Hex16
    snapshot_fingerprint: Hex64
    cutoff: Stamp
    generated_at: Stamp

    _clock = field_validator("cutoff", "generated_at")(_stamp)


class Coverage(Strict):
    retained_total: Annotated[int, Field(ge=0, le=100_000)]
    window_total: Annotated[int, Field(ge=0, le=100_000)]
    displayed: Annotated[int, Field(ge=0, le=MAX_CARDS)]
    clipped: Annotated[int, Field(ge=0, le=100_000)]
    outside_window: Annotated[int, Field(ge=0, le=100_000)]
    running_outside_window: Annotated[int, Field(ge=0, le=100_000)]
    unsupported_last_poll: Annotated[int, Field(ge=0, le=1_000_000)] | None
    card_limit: Annotated[int, Field(ge=1, le=MAX_CARDS)]
    window_from: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    window_through: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    window_day_utc: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    note: str


class Credit(Strict):
    text: str
    url: str
    terms_url: str


class ProviderDisplay(Strict):
    schema_version: Literal["arena-live-display-1.0"] = SCHEMA
    data_kind: Literal["processed_api_display"] = "processed_api_display"
    provider: Provider
    facts_version: Hex16
    canonical: CanonicalIdentity | None
    health: Health
    coverage: Coverage
    attribution: Credit
    license_note: str
    cards: Annotated[list[Card], Field(max_length=MAX_CARDS)]


class Manifest(Strict):
    schema_version: Literal["arena-live-display-1.0"] = SCHEMA
    data_kind: Literal["processed_api_display"] = "processed_api_display"
    display_version: Hex16
    package_fingerprint: Hex64
    generated_at: Stamp
    window_day_utc: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    providers: list[Provider]
    facts_versions: dict[Provider, Hex16]
    files: dict[str, Hex64]
    processing_note: str

    _clock = field_validator("generated_at")(_stamp)


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _checked(model, value):
    try:
        return model.model_validate(value).model_dump()
    except (ValidationError, ValueError, TypeError):
        raise DisplayError("invalid_display_contract") from None


def _identity(provider, identity, kind="match"):
    return f"{provider}-{_hash((provider + chr(0) + kind + chr(0) + identity).encode())[:16]}"


def _clock(now):
    now = now or datetime.now(timezone.utc)
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise DisplayError("aware_clock_required")
    return now.astimezone(timezone.utc)


def _card(row, now):
    kickoff = utc_time(row.start_time)
    allowed = row.status in ("running", "finished") and kickoff <= now
    scores = allowed and row.score_a is not None and row.score_b is not None
    score = f"{row.score_a}–{row.score_b}" if scores else None
    final = scores and row.status == "finished"
    winner = ("team_a" if row.score_a > row.score_b else "team_b" if row.score_b > row.score_a else "draw") if final else None
    return _checked(Card, dict(display_id=_identity(row.provider, row.match_id), sport=row.sport,
        competition_label=row.competition,
        team_a=dict(display_id=_identity(row.provider, row.team_a_id, "team"), label=row.team_a),
        team_b=dict(display_id=_identity(row.provider, row.team_b_id, "team"), label=row.team_b),
        kickoff_utc=_stamp(row.start_time), day_utc=kickoff.date().isoformat(), kickoff_label=kickoff.strftime("%H:%M UTC"),
        status_label=LABELS[row.status], series_format="Single match" if row.sport == "football" else f"Best of {row.best_of}",
        score_label=score, result_state="final" if final else "provisional" if scores else "unavailable", winning_side=winner))


def _sort_card(card, now):
    kickoff = utc_time(card["kickoff_utc"])
    if card["status_label"] == "In progress":
        return (0, kickoff.timestamp(), card["display_id"])
    if card["status_label"] == "Scheduled":
        return (1, kickoff.timestamp(), card["display_id"])
    return (2, -kickoff.timestamp(), card["display_id"])


def _sort_match(row, now):
    kickoff = utc_time(row.start_time)
    rank = 0 if row.status == "running" else 1 if row.status == "scheduled" else 2
    return (rank, kickoff.timestamp() if rank < 2 else -kickoff.timestamp(), _identity(row.provider, row.match_id))


def _facts(payload):
    # Source fingerprints, poll counters and clocks are provenance/freshness,
    # not displayed facts. Actual card/window changes do change facts identity.
    return dict(provider=payload["provider"], cards=sorted(payload["cards"], key=lambda row: row["display_id"])) | {
        "coverage": {key: value for key, value in payload["coverage"].items()
                     if key not in ("unsupported_last_poll", "note")}}


def _provider(capture, now, limit):
    provider, status, dataset = capture.provider, capture.status, capture.dataset
    source = None if dataset is None else dict(dataset_version=dataset.manifest["dataset_version"],
        snapshot_fingerprint=dataset.fingerprint, cutoff=dataset.manifest["as_of"], generated_at=dataset.manifest["generated_at"])
    begin, through = now.date() - timedelta(days=14), now.date() + timedelta(days=30)
    rows = list(dataset.by_id.values()) if dataset else []
    in_window = [row for row in rows if begin <= utc_time(row.start_time).date() <= through or row.status == "running"]
    in_window.sort(key=lambda row: _sort_match(row, now))
    cards = [_card(row, now) for row in in_window[:limit]]
    age = (now - utc_time(status.last_success_at)).total_seconds() if status and status.last_success_at else None
    threshold = max(120, 2 * status.poll_interval_seconds) if status else None
    stale = age is None or age > threshold or capture.state in ("invalid_publication", "not_connected") or capture.serving_last_good
    state = "stale" if stale and capture.state == "ready" else capture.state
    error = capture.error or (status.last_error_code if status else None)
    if error is not None and error not in ERROR_CODES:
        error = "invalid_publication"
    health = dict(state=state, producer_state=status.status if status else None, stale=stale,
        serving_last_good=capture.serving_last_good, last_attempt_at=status.last_attempt_at if status else None,
        last_success_at=status.last_success_at if status else None, last_change_at=status.last_change_at if status else None,
        poll_interval_seconds=status.poll_interval_seconds if status else None, stale_after_seconds=threshold,
        source_scope=status.source_scope.model_dump() if status and status.source_scope else None,
        attempt_scope=status.source_scope.model_dump() if status and status.source_scope else None,
        freshness_scope="declared_poll_scope" if status and status.source_scope else "unknown_poll_scope",
        error_code=error, scores_delayed=True if provider == "football-data" else None)
    coverage = dict(retained_total=len(rows), window_total=len(in_window), displayed=len(cards),
        clipped=len(in_window) - len(cards), outside_window=len(rows) - len(in_window),
        running_outside_window=sum(row.status == "running" and not begin <= utc_time(row.start_time).date() <= through for row in in_window),
        unsupported_last_poll=status.last_poll.unsupported_rows if status else None, card_limit=limit,
        window_from=begin.isoformat(), window_through=through.isoformat(),
        window_day_utc=now.date().isoformat(),
        note="Retained canonical records in the UTC day window, plus source-reported running matches. Unresolved announcements are a separate private calendar; clipped pages are not complete provider coverage.")
    payload = dict(provider=provider, canonical=source, health=health, coverage=coverage,
                   attribution=ATTRIBUTION[provider], license_note=LICENSE_NOTE, cards=cards)
    payload["facts_version"] = _hash(_canonical(_facts(payload)))[:16]
    return _checked(ProviderDisplay, payload)


def _fingerprint(version, files, schema_version=SCHEMA):
    return _hash(_canonical(dict(schema_version=schema_version, display_version=version, files=files)))


def _safe(path):
    if ".." in path.parts:
        raise DisplayError("unsafe_path")
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 1024:
            raise DisplayError("unsafe_path")


def _read(path, limit):
    _safe(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise DisplayError("size_limit")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise DisplayError("unsafe_path")
        raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise DisplayError("size_limit")
    return raw


def _json(raw):
    def unique(pairs):
        values = {}
        for key, value in pairs:
            if key in values:
                raise DisplayError("duplicate_json_keys")
            values[key] = value
        return values
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(DisplayError("nonfinite_json")))
    except (ValueError, UnicodeError, RecursionError):
        raise DisplayError("invalid_json") from None


def _validate_payload(payload, manifest, now):
    provider, coverage, health = payload["provider"], payload["coverage"], payload["health"]
    published = utc_time(manifest["generated_at"])
    if payload["attribution"] != ATTRIBUTION[provider] or payload["license_note"] != LICENSE_NOTE:
        raise DisplayError("attribution_mismatch")
    if health["scores_delayed"] is not (True if provider == "football-data" else None):
        raise DisplayError("provider_capability_mismatch")
    for key in ("last_attempt_at", "last_success_at", "last_change_at"):
        if health[key] and utc_time(health[key]) > published:
            raise DisplayError("future_source_clock")
    if health["last_change_at"] and (not health["last_success_at"] or health["last_change_at"] > health["last_success_at"]):
        raise DisplayError("source_clock_order")
    threshold = max(120, 2 * health["poll_interval_seconds"]) if health["poll_interval_seconds"] else None
    age = (published - utc_time(health["last_success_at"])).total_seconds() if health["last_success_at"] else None
    if age is not None and threshold is None:
        raise DisplayError("missing_poll_cadence")
    if health["state"] in ("ready", "stale", "empty") and health["last_success_at"] is None:
        raise DisplayError("missing_success_clock")
    stale = age is None or age > threshold or health["state"] in ("invalid_publication", "not_connected") or health["serving_last_good"]
    if health["stale_after_seconds"] != threshold or health["stale"] != stale:
        raise DisplayError("freshness_mismatch")
    if health["state"] == "ready" and stale or health["state"] == "stale" and not stale:
        raise DisplayError("freshness_state_mismatch")
    scope = health["source_scope"]
    if health["freshness_scope"] != ("declared_poll_scope" if scope else "unknown_poll_scope"):
        raise DisplayError("poll_scope_mismatch")
    for checked_scope in (scope, health["attempt_scope"]):
        if not checked_scope:
            continue
        if len(set(checked_scope["competition_codes"])) != len(checked_scope["competition_codes"]) or len(set(checked_scope["phases"])) != len(checked_scope["phases"]):
            raise DisplayError("poll_scope_mismatch")
        if (provider == "football-data" and (checked_scope["kind"] != "competition_list" or not checked_scope["competition_codes"] or checked_scope["phases"])
            or provider == "pandascore" and (checked_scope["kind"] != "match_phases" or checked_scope["competition_codes"] or not checked_scope["phases"])):
            raise DisplayError("poll_scope_mismatch")
    canonical = payload["canonical"]
    if canonical:
        if not utc_time(canonical["cutoff"]) <= utc_time(canonical["generated_at"]) <= published <= now:
            raise DisplayError("canonical_clock_mismatch")
        if health["last_success_at"] and utc_time(canonical["cutoff"]) > utc_time(health["last_success_at"]):
            raise DisplayError("canonical_cutoff_after_check")
    elif payload["cards"] or coverage["retained_total"] or health["serving_last_good"] or health["state"] == "ready":
        raise DisplayError("unavailable_provider_has_data")
    window_day = date.fromisoformat(coverage["window_day_utc"])
    if window_day > published.date() or window_day != published.date() and not health["serving_last_good"]:
        raise DisplayError("window_clock_mismatch")
    begin = window_day - timedelta(days=14)
    through = window_day + timedelta(days=30)
    if coverage["window_from"] != begin.isoformat() or coverage["window_through"] != through.isoformat():
        raise DisplayError("window_mismatch")
    if (coverage["displayed"] != len(payload["cards"]) or coverage["displayed"] > coverage["card_limit"]
            or coverage["window_total"] != coverage["displayed"] + coverage["clipped"]
            or coverage["retained_total"] != coverage["window_total"] + coverage["outside_window"]
            or coverage["running_outside_window"] > coverage["window_total"]):
        raise DisplayError("coverage_counts_mismatch")
    cards, identities = payload["cards"], set()
    for card in cards:
        if card["display_id"] in identities:
            raise DisplayError("duplicate_display_identity")
        identities.add(card["display_id"])
        if any(not obj["display_id"].startswith(provider + "-") for obj in (card, card["team_a"], card["team_b"])):
            raise DisplayError("cross_provider_card")
        if card["team_a"]["display_id"] == card["team_b"]["display_id"] or card["sport"] != ("football" if provider == "football-data" else "valorant"):
            raise DisplayError("invalid_display_teams_or_sport")
        kickoff = utc_time(card["kickoff_utc"])
        if card["day_utc"] != kickoff.date().isoformat() or card["kickoff_label"] != kickoff.strftime("%H:%M UTC"):
            raise DisplayError("derived_date_mismatch")
        if not begin <= kickoff.date() <= through and card["status_label"] != "In progress":
            raise DisplayError("card_outside_window")
        football = card["sport"] == "football"
        if football and card["series_format"] != "Single match" or not football and not card["series_format"].startswith("Best of "):
            raise DisplayError("series_format_mismatch")
        score = card["score_label"]
        if score is None:
            if card["result_state"] != "unavailable" or card["winning_side"] is not None:
                raise DisplayError("unconfirmed_result_mismatch")
            if card["status_label"] == "Finished":
                raise DisplayError("finished_result_missing")
        else:
            if kickoff > published or card["status_label"] not in ("Finished", "In progress"):
                raise DisplayError("result_before_start_or_wrong_status")
            a, b = map(int, score.split("–"))
            final = card["status_label"] == "Finished"
            winner = ("team_a" if a > b else "team_b" if b > a else "draw") if final else None
            if card["result_state"] != ("final" if final else "provisional") or card["winning_side"] != winner:
                raise DisplayError("derived_result_mismatch")
            if final and not football:
                best_of = int(card["series_format"].rsplit(" ", 1)[1])
                needed = best_of // 2 + 1
                if best_of % 2 == 0 or max(a, b) != needed or min(a, b) >= needed:
                    raise DisplayError("invalid_series_result")
    if cards != sorted(cards, key=lambda card: _sort_card(card, published)):
        raise DisplayError("display_order_mismatch")
    if payload["facts_version"] != _hash(_canonical(_facts(payload)))[:16]:
        raise DisplayError("facts_version_mismatch")


def _schema_models(schema_version):
    if schema_version == SCHEMA:
        return Manifest, ProviderDisplay, _validate_payload
    if schema_version == "arena-live-display-2.0":
        from .live_directory import ManifestV2, ProviderDisplayV2, validate_provider
        return ManifestV2, ProviderDisplayV2, validate_provider
    raise DisplayError("unsupported_display_contract")


def validate_display_bytes(manifest_raw: bytes, provider_raw: dict[str, bytes], *,
                           now: datetime | None = None) -> dict:
    """Validate exactly the same bounded wire bytes for file and API transport."""
    now = _clock(now)
    if type(manifest_raw) is not bytes or len(manifest_raw) > 64 * 1024:
        raise DisplayError("size_limit")
    if type(provider_raw) is not dict or set(provider_raw) != set(PROVIDERS):
        raise DisplayError("invalid_provider_inventory")
    if any(type(raw) is not bytes or len(raw) > MAX_FILE_BYTES for raw in provider_raw.values()):
        raise DisplayError("size_limit")
    raw_manifest = _json(manifest_raw)
    if not isinstance(raw_manifest, dict):
        raise DisplayError("invalid_display_contract")
    manifest_model, provider_model, validate_provider = _schema_models(raw_manifest.get("schema_version"))
    manifest = _checked(manifest_model, raw_manifest)
    if manifest["schema_version"] != SCHEMA and manifest != raw_manifest:
        raise DisplayError("noncanonical_display_fields")
    if (manifest["providers"] != list(PROVIDERS) or set(manifest["files"]) != set(FILES)
            or set(manifest["facts_versions"]) != set(PROVIDERS)):
        raise DisplayError("invalid_provider_inventory")
    published = utc_time(manifest["generated_at"])
    if published > now or manifest["window_day_utc"] != published.date().isoformat():
        raise DisplayError("future_or_invalid_publication_clock")
    payloads = {}
    for provider, filename in zip(PROVIDERS, FILES, strict=True):
        raw = provider_raw[provider]
        if _hash(raw) != manifest["files"][filename]:
            raise DisplayError("checksum_mismatch")
        raw_payload = _json(raw)
        payload = _checked(provider_model, raw_payload)
        if manifest["schema_version"] != SCHEMA and payload != raw_payload:
            raise DisplayError("noncanonical_display_fields")
        if payload["provider"] != provider or manifest["facts_versions"][provider] != payload["facts_version"]:
            raise DisplayError("provider_or_facts_version_mismatch")
        validate_provider(payload, manifest, now)
        payloads[provider] = payload
    if manifest["display_version"] != _hash(_canonical(payloads))[:16]:
        raise DisplayError("display_version_mismatch")
    if manifest["package_fingerprint"] != _fingerprint(manifest["display_version"], manifest["files"], manifest["schema_version"]):
        raise DisplayError("package_fingerprint_mismatch")
    return dict(manifest=manifest, providers=payloads)


def validate_live_display(directory: Path, *, now: datetime | None = None) -> dict:
    """Validate either explicit display version, independently of private loading."""
    directory = Path(directory).absolute()
    _safe(directory)
    entries = []
    for entry in directory.iterdir():
        if len(entries) >= 3:
            raise DisplayError("unexpected_inventory")
        entries.append(entry)
    if {entry.name for entry in entries} != {"manifest.json", *FILES}:
        raise DisplayError("unexpected_inventory")
    return validate_display_bytes(_read(directory / "manifest.json", 64 * 1024),
        {provider: _read(directory / f"{provider}.json", MAX_FILE_BYTES) for provider in PROVIDERS}, now=now)


def _previous_provider(current, previous):
    if previous["canonical"] is None:
        return current
    current = json.loads(_canonical(current))
    for key in ("canonical", "coverage", "cards", "facts_version"):
        current[key] = previous[key]
    old, health = previous["health"], current["health"]
    for key in ("last_success_at", "last_change_at", "poll_interval_seconds", "stale_after_seconds",
                "source_scope", "freshness_scope"):
        health[key] = old[key]
    health["serving_last_good"] = health["stale"] = True
    if health["state"] in ("ready", "empty", "stale"):
        health["state"] = "degraded"
    return _checked(ProviderDisplay, current)


def _previous_is_newer(current, previous):
    """Prefer an available current capture unless previous clocks dominate.

    A later package-build clock is never evidence of newer source facts. A
    previous cutoff must be at least as recent, with a later coherent successful
    check (or later cutoff when both successful checks are unknown). Conflicting
    clock orderings retain the current independently verified capture.
    """
    old_source, source = previous["canonical"], current["canonical"]
    if old_source is None:
        return False
    if source is None:
        return True
    old_cutoff, cutoff = utc_time(old_source["cutoff"]), utc_time(source["cutoff"])
    if old_cutoff < cutoff:
        return False
    old_success = previous["health"]["last_success_at"]
    success = current["health"]["last_success_at"]
    if old_success is None:
        return success is None and old_cutoff > cutoff
    if success is None:
        return True
    return utc_time(old_success) >= utc_time(success) and (old_cutoff > cutoff or utc_time(old_success) > utc_time(success))


def _build_display(registry, now, limit, previous, schema_version):
    if type(limit) is not int or not 1 <= limit <= MAX_CARDS:
        raise DisplayError("card_limit_out_of_bounds")
    manifest_model, _, _ = _schema_models(schema_version)
    captures = {provider: registry.capture(provider) for provider in PROVIDERS}
    now = _clock(now)
    if any(capture.provider != provider or capture.now > now for provider, capture in captures.items()):
        raise DisplayError("capture_clock_or_provider_mismatch")
    links = {provider: {} for provider in PROVIDERS}
    if schema_version == SCHEMA:
        payloads = {provider: _provider(captures[provider], now, limit) for provider in PROVIDERS}
    else:
        from .live_directory import project_provider
        payloads = {}
        for provider in PROVIDERS:
            payloads[provider], links[provider] = project_provider(captures[provider], now, limit)
    if previous is not None:
        old = validate_live_display(previous, now=now)
        if schema_version == SCHEMA and old["manifest"]["schema_version"] != SCHEMA:
            raise DisplayError("previous_contract_downgrade")
        for provider, capture in captures.items():
            needs_recovery = ((capture.dataset is None and (schema_version == SCHEMA or capture.calendar is None))
                or capture.state in ("degraded", "quota_limited", "invalid_publication",
                    "not_connected", "awaiting_credentials") or capture.error is not None)
            prior = old["providers"][provider]
            if schema_version == SCHEMA:
                if needs_recovery and _previous_is_newer(payloads[provider], prior):
                    payloads[provider] = _previous_provider(payloads[provider], prior)
            else:
                from .live_directory import adapt_legacy, recover_provider, recovery_is_newer
                if old["manifest"]["schema_version"] == SCHEMA:
                    prior = adapt_legacy(prior, utc_time(old["manifest"]["generated_at"]))
                if needs_recovery and recovery_is_newer(payloads[provider], prior):
                    payloads[provider] = recover_provider(payloads[provider], prior)
                    # A static prior package never proves a private current-record link.
                    links[provider] = {}
    version = _hash(_canonical(payloads))[:16]
    bodies = {f"{provider}.json": _canonical(payload) + b"\n" for provider, payload in payloads.items()}
    if any(len(raw) > MAX_FILE_BYTES for raw in bodies.values()):
        raise DisplayError("size_limit")
    file_hashes = {name: _hash(raw) for name, raw in bodies.items()}
    manifest = _checked(manifest_model, dict(schema_version=schema_version, data_kind="processed_api_display",
        display_version=version, package_fingerprint=_fingerprint(version, file_hashes, schema_version),
        generated_at=_stamp(now.isoformat()), window_day_utc=now.date().isoformat(), providers=list(PROVIDERS),
        facts_versions={provider: payload["facts_version"] for provider, payload in payloads.items()}, files=file_hashes,
        processing_note="Own-site processed rolling match cards only; no raw database, provider API access, forecasts, round feeds, logos, or personal data."))
    manifest_raw = _canonical(manifest) + b"\n"
    validate_display_bytes(manifest_raw, {provider: bodies[f"{provider}.json"] for provider in PROVIDERS}, now=now)
    return manifest, manifest_raw, bodies, payloads, links, now


def local_display_envelope(registry: LiveRegistry, *, now: datetime | None = None,
                           limit: int = MAX_CARDS) -> dict:
    """Read-only processed local transport; each provider is captured just once."""
    _, manifest_raw, bodies, _, links, instant = _build_display(
        registry, now, limit, None, "arena-live-display-2.0")
    envelope = dict(manifest_json=manifest_raw.decode("utf-8"),
        provider_json={provider: bodies[f"{provider}.json"].decode("utf-8") for provider in PROVIDERS},
        canonical_links=links, captured_at=_stamp(instant.isoformat()))
    if len(_canonical(envelope)) > 9 * 1024 * 1024:
        raise DisplayError("size_limit")
    return envelope


def export_live_display(registry: LiveRegistry, output: Path, *, now: datetime | None = None,
                        limit: int = MAX_CARDS, previous: Path | None = None,
                        schema_version: str = SCHEMA) -> dict:
    """Capture once and atomically create a three-file package of an explicit version.

    V1 remains the compatibility default for existing callers. Publishing entry
    points select V2. Identical packages can be reused; different existing output
    is rejected rather than partially overwritten.
    """
    manifest, manifest_raw, bodies, payloads, _, now = _build_display(
        registry, now, limit, previous, schema_version)
    output = Path(output).absolute()
    _safe(output)
    if output.exists():
        previous = validate_live_display(output, now=now)
        if previous["providers"] != payloads:
            raise DisplayError("output_exists_with_different_display")
        return previous["manifest"]
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.parent / f".live-display-{uuid.uuid4().hex}.tmp"
    staging.mkdir()
    try:
        for filename, raw in {**bodies, "manifest.json": manifest_raw}.items():
            with (staging / filename).open("xb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
        validate_live_display(staging, now=now)
        staging.rename(output)
    finally:
        if staging.exists():
            if not staging.resolve().is_relative_to(output.parent.resolve()):
                raise DisplayError("unsafe_cleanup")
            shutil.rmtree(staging)
    return manifest
