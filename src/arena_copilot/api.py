import os
from datetime import date
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .agent import Copilot, ModelBusy, ModelUnavailable, RequestDeadline
from .analytics import envelope, sports_catalog, table_rows
from .snapshot import default_fixture
from .openfootball import OpenFootballResearch, ResearchError, default_research
from .research_agent import ResearchCopilot
from .live import LiveRegistry, create_live_router
from .live_agent import LiveCopilot, SnapshotChanged
from .live_publication import DisplayError, local_display_envelope
from . import __version__


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    mode: Literal["ollama", "evidence"] = "ollama"
    retrieval: Literal["lexical", "hybrid"] = "lexical"


class FeedbackRequest(BaseModel):
    trace_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    rating: Literal[-1, 1]
    comment: str = Field(default="", max_length=1000)


class ResearchChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)
    mode: Literal["ollama", "evidence"] = "ollama"
    match_id: str | None = Field(default=None, pattern=r"^openfootball:match:[a-f0-9]{24}$")
    team_id: str | None = Field(default=None, pattern=r"^openfootball:team:[a-f0-9]{24}$")
    edition_id: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{0,79}$")

    @model_validator(mode="after")
    def one_context(self):
        if sum(value is not None for value in (self.match_id, self.team_id, self.edition_id)) > 1:
            raise ValueError("Select at most one research match, team or edition")
        return self


class LiveChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["football-data", "pandascore"]
    question: str = Field(min_length=1, max_length=2000)
    mode: Literal["ollama", "evidence"] = "ollama"
    match_id: str | None = Field(default=None, pattern=r"^(?:football-data|pandascore):[0-9]{1,20}$")
    team_id: str | None = Field(default=None, pattern=r"^(?:football-data|pandascore):[0-9]{1,20}$")
    snapshot_fingerprint: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def one_provider_context(self):
        if self.match_id is not None and self.team_id is not None:
            raise ValueError("Select at most one current match or team")
        for value in (self.match_id, self.team_id):
            if value is not None and not value.startswith(self.provider + ":"):
                raise ValueError("Current context must belong to the selected provider")
        return self


class LiveFeedbackRequest(FeedbackRequest):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["football-data", "pandascore"]
    snapshot_fingerprint: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


def create_app(copilot=None, research=None, live=None):
    load_dotenv()
    live_registry = live or LiveRegistry(Path(os.environ.get("ARENA_LIVE_WORKSPACE", "data/live")))
    @asynccontextmanager
    async def lifespan(app):
        load_dotenv()
        app.state.copilot = copilot or Copilot(Path(os.environ.get("ARENA_SNAPSHOT") or default_fixture()),
                                             Path(os.environ.get("ARENA_STATE", "data/copilot")))
        app.state.research_copilot = None
        app.state.live_copilot = None
        try:
            app.state.live_copilot = LiveCopilot(live_registry, app.state.copilot,
                                               app.state.copilot.state / "live")
            research_path = Path(os.environ.get("ARENA_OPEN_FOOTBALL") or default_research())
            app.state.openfootball = research or (OpenFootballResearch(research_path) if research_path.exists() else None)
            if app.state.openfootball is not None:
                app.state.research_copilot = ResearchCopilot(app.state.openfootball, app.state.copilot,
                                                            app.state.copilot.state / "research")
            yield
        finally:
            if app.state.live_copilot is not None:
                app.state.live_copilot.close()
            live_registry.close()
            if app.state.research_copilot is not None:
                app.state.research_copilot.close()
            app.state.copilot.close()

    app = FastAPI(title="Arena Copilot", version=__version__, lifespan=lifespan)
    router = APIRouter()

    def openfootball():
        source = app.state.openfootball
        if source is None:
            raise HTTPException(503, "The verified OpenFootball research package is unavailable.")
        return source

    @router.get("/live/display")
    def live_display():
        try:
            return local_display_envelope(live_registry)
        except (DisplayError, ValueError, OSError):
            raise HTTPException(503, "The verified current display is unavailable.") from None

    @router.post("/live/chat")
    def live_chat(request: LiveChatRequest):
        try:
            context = request.model_dump(exclude={"provider", "question", "mode"}, exclude_none=True)
            return app.state.live_copilot.ask(request.provider, request.question,
                                             mode=request.mode, **context)
        except SnapshotChanged as error:
            raise HTTPException(409, str(error)) from error
        except ModelBusy as error:
            raise HTTPException(429, str(error)) from error
        except ModelUnavailable as error:
            raise HTTPException(503, str(error)) from error
        except RequestDeadline as error:
            raise HTTPException(504, str(error)) from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    @router.post("/live/feedback")
    def live_feedback(request: LiveFeedbackRequest):
        try:
            app.state.live_copilot.feedback(request.provider, request.trace_id, request.rating,
                                           request.comment, snapshot_fingerprint=request.snapshot_fingerprint)
        except ValueError as error:
            raise HTTPException(404, str(error)) from error
        return dict(status="saved", provider=request.provider, trace_id=request.trace_id)

    @router.get("/open-football/health")
    def openfootball_health():
        source = openfootball()
        return source.envelope([], status="ready", snapshot_verified=True, predictions_available=False)

    @router.get("/open-football/snapshot")
    def openfootball_snapshot():
        return openfootball().snapshot()

    @router.post("/open-football/chat")
    def openfootball_chat(request: ResearchChatRequest):
        openfootball()
        try:
            context = request.model_dump(exclude={"question", "mode"}, exclude_none=True)
            return app.state.research_copilot.ask(request.question, mode=request.mode, **context)
        except ModelBusy as error:
            raise HTTPException(429, str(error)) from error
        except ModelUnavailable as error:
            raise HTTPException(503, str(error)) from error
        except RequestDeadline as error:
            raise HTTPException(504, str(error)) from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    @router.post("/open-football/feedback")
    def openfootball_feedback(request: FeedbackRequest):
        openfootball()
        try:
            app.state.research_copilot.feedback(request.trace_id, request.rating, request.comment)
        except ValueError as error:
            raise HTTPException(404, str(error)) from error
        return dict(status="saved", trace_id=request.trace_id)

    @router.get("/open-football/competitions")
    def openfootball_competitions(search: str | None = Query(None, max_length=100),
                                 region: str | None = Query(None, max_length=100),
                                 limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000)):
        return openfootball().competitions(search=search, region=region, limit=limit, offset=offset)

    @router.get("/open-football/matches")
    def openfootball_matches(edition_id: str | None = Query(None, max_length=100),
                            team_id: str | None = Query(None, max_length=100),
                            search: str | None = Query(None, max_length=100),
                            source_group: str | None = Query(None, max_length=120),
                            round: str | None = Query(None, max_length=120),
                            result_status: Literal["observed_result", "unknown_result"] | None = None,
                            date_from: date | None = None, date_to: date | None = None,
                            order: Literal["asc", "desc"] = "desc",
                            limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000)):
        try:
            return openfootball().matches(edition_id=edition_id, team_id=team_id, search=search,
                result_status=result_status, source_group=source_group, round=round,
                date_from=date_from, date_to=date_to, order=order, limit=limit, offset=offset)
        except ResearchError as error:
            raise HTTPException(400, str(error)) from error

    @router.get("/open-football/teams")
    def openfootball_teams(search: str | None = Query(None, max_length=100),
                           team_type: Literal["club", "national"] | None = None,
                           limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000)):
        return openfootball().teams(search=search, team_type=team_type, limit=limit, offset=offset)

    @router.get("/open-football/teams/{team_id}")
    def openfootball_team(team_id: str,
                          source_group: str | None = Query(None, max_length=120),
                          round: str | None = Query(None, max_length=120),
                          result_status: Literal["observed_result", "unknown_result"] | None = None,
                          date_from: date | None = None, date_to: date | None = None,
                          limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000)):
        try:
            return openfootball().team(team_id, result_status=result_status, source_group=source_group,
                                       round=round, date_from=date_from,
                                       date_to=date_to, limit=limit, offset=offset)
        except KeyError as error:
            raise HTTPException(404, str(error)) from error
        except ResearchError as error:
            raise HTTPException(400, str(error)) from error

    @router.get("/open-football/competitions/{edition_id}")
    def openfootball_competition(edition_id: str,
                               source_group: str | None = Query(None, max_length=120),
                               round: str | None = Query(None, max_length=120),
                               result_status: Literal["observed_result", "unknown_result"] | None = None,
                               date_from: date | None = None, date_to: date | None = None,
                               limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000)):
        try:
            return openfootball().competition(edition_id, result_status=result_status, source_group=source_group,
                                             round=round, date_from=date_from,
                                             date_to=date_to, limit=limit, offset=offset)
        except KeyError as error:
            raise HTTPException(404, str(error)) from error
        except ResearchError as error:
            raise HTTPException(400, str(error)) from error

    @router.get("/open-football/matches/{match_id}")
    def openfootball_match(match_id: str):
        try:
            return openfootball().match(match_id)
        except KeyError as error:
            raise HTTPException(404, str(error)) from error

    @router.get("/health")
    def health():
        agent = app.state.copilot
        return dict(status="ready", snapshot_verified=True, dataset_version=agent.manifest["dataset_version"],
                    data_kind=agent.manifest["data_kind"], as_of=agent.manifest["as_of"],
                    snapshot_fingerprint=agent.snapshot_fingerprint,
                    model=agent.model, ollama_status="not_checked")

    @router.post("/chat")
    def chat(body: ChatRequest):
        try:
            return app.state.copilot.ask(body.question, body.mode, retrieval=body.retrieval)
        except ModelUnavailable as error:
            raise HTTPException(503, str(error)) from error
        except ModelBusy as error:
            raise HTTPException(429, str(error), headers={"Retry-After": "5"}) from error
        except RequestDeadline as error:
            raise HTTPException(504, str(error)) from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    @router.post("/feedback")
    def feedback(body: FeedbackRequest):
        try:
            app.state.copilot.feedback(body.trace_id, body.rating, body.comment)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"status": "recorded"}

    @router.get("/matches")
    def matches(sport: Literal["football", "valorant"] | None = None,
                status: Literal["scheduled", "running", "finished", "cancelled", "postponed"] | None = None,
                team_name: str | None = Query(None, max_length=100),
                limit: int = Query(1000, ge=1, le=1000), offset: int = Query(0, ge=0, le=1_000_000),
                competition_id: str | None = Query(None, max_length=100),
                competition: str | None = Query(None, max_length=120),
                search: str | None = Query(None, max_length=100), date_from: date | None = None, date_to: date | None = None,
                order: Literal["asc", "desc"] = "desc"):
        agent = app.state.copilot
        try:
            rows, total = table_rows(agent.snapshot, "matches", sport, team_name, status, limit, offset,
                competition_id=competition_id, competition=competition, search=search,
                date_from=date_from, date_to=date_to, order=order)
            catalog = sports_catalog(agent)
            rows = [catalog.match_row(row) for row in rows]
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return envelope(agent, rows, total=total, limit=limit, offset=offset, order=order, contract_version="sports-1.0")

    @router.get("/competitions")
    def competitions(sport: Literal["football", "valorant"] | None = None,
                     search: str | None = Query(None, max_length=100),
                     status: Literal["upcoming", "ongoing", "completed", "inactive"] | None = None,
                     limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0, le=1_000_000)):
        agent = app.state.copilot
        try:
            result = sports_catalog(agent).competitions(sport, search, status, limit, offset)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return envelope(agent, result.pop("rows"), **result)

    @router.get("/competitions/{competition_id}")
    def competition_detail(competition_id: str,
                           status: Literal["scheduled", "running", "finished", "cancelled", "postponed"] | None = None,
                           search: str | None = Query(None, max_length=100),
                           date_from: date | None = None, date_to: date | None = None,
                           order: Literal["asc", "desc"] = "desc",
                           limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0, le=1_000_000)):
        agent = app.state.copilot
        try:
            result = sports_catalog(agent).competition_detail(competition_id, status=status, search=search,
                date_from=date_from, date_to=date_to, order=order, limit=limit, offset=offset)
        except KeyError as error:
            raise HTTPException(404, str(error)) from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return envelope(agent, result.pop("rows"), **result)

    @router.get("/matches/{match_id}")
    def match_detail(match_id: str):
        agent = app.state.copilot
        try:
            result = sports_catalog(agent).match_detail(match_id)
        except KeyError as error:
            raise HTTPException(404, str(error)) from error
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return envelope(agent, result.pop("rows"), **result)

    @router.get("/teams")
    def teams(sport: Literal["football", "valorant"] | None = None,
              team_name: str | None = Query(None, max_length=100)):
        agent = app.state.copilot
        rows, total = table_rows(agent.snapshot, "team_stats", sport, team_name)
        return envelope(agent, rows, total=total)

    @router.get("/predictions")
    def predictions(sport: Literal["football", "valorant"] | None = None):
        agent = app.state.copilot
        rows = agent.tools.read_json("predictions.json")
        return envelope(agent, [r for r in rows if not sport or r["sport"] == sport])

    @router.get("/models")
    def models():
        agent = app.state.copilot
        report = agent.tools.read_json("model_report.json")
        return envelope(agent, [dict(sport=sport, **card) for sport, card in report.get("sports", {}).items()])

    @router.get("/quality")
    def quality():
        agent = app.state.copilot
        return envelope(agent, [agent.tools.read_json("quality.json")], incidents=agent.tools.read_json("incidents.json"))

    @router.get("/catalog")
    def catalog():
        agent = app.state.copilot
        return envelope(agent, agent.tools.read_json("catalog.json"))

    @router.get("/lineage")
    def lineage():
        agent = app.state.copilot
        return envelope(agent, agent.tools.read_json("lineage.json"))

    @router.get("/documents")
    def documents():
        agent = app.state.copilot
        return envelope(agent, agent.retriever.documents)

    @router.get("/overview")
    def overview(sport: Literal["football", "valorant"] = "football"):
        agent = app.state.copilot
        recent, total = table_rows(agent.snapshot, "matches", sport, limit=12)
        _, completed = table_rows(agent.snapshot, "matches", sport, status="finished", limit=1)
        _, upcoming = table_rows(agent.snapshot, "matches", sport, status="scheduled", limit=1)
        team_rows, team_count = table_rows(agent.snapshot, "team_stats", sport)
        forecasts = [p for p in agent.tools.read_json("predictions.json") if p["sport"] == sport]
        return dict(dataset_version=agent.manifest["dataset_version"], snapshot_fingerprint=agent.snapshot_fingerprint,
            data_kind=agent.manifest["data_kind"], as_of=agent.manifest["as_of"], sport=sport,
            summary=dict(total_matches=total, completed_matches=completed, upcoming_matches=upcoming,
                         teams=team_count, predictions=len(forecasts),
                         quarantined_events=agent.tools.read_json("quality.json")["summary"]["quarantined"]),
            recent_matches=recent, predictions=forecasts, teams=team_rows)

    app.include_router(router)
    app.include_router(router, prefix="/api")
    live_router = create_live_router(live_registry)
    app.include_router(live_router)
    app.include_router(live_router, prefix="/api")
    web_root = Path(os.environ.get("ARENA_WEB_DIST", "web/dist")).resolve()
    if (web_root / "index.html").is_file():
        # API routes retain precedence; serve only the built public directory.
        app.mount("/", StaticFiles(directory=web_root, html=True), name="web")

    return app


app = create_app()
