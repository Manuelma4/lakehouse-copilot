"""Local Streamlit workspace. Model predictions are displayed separately from chat prose."""

import os
from pathlib import Path

import httpx
import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from arena_copilot.snapshot import default_fixture, validate_snapshot
from arena_copilot.tools import Tools

load_dotenv()
st.set_page_config(page_title="Arena | Football + VALORANT", page_icon="◈", layout="wide")
st.markdown("""<style>
[data-testid="stAppViewContainer"] {background: #0b1018; color: #edf3fa;}
[data-testid="stSidebar"] {background: #111925; border-right: 1px solid #233043;}
.arena-eyebrow {color:#93b4cf;letter-spacing:.19em;font-size:12px;font-weight:700;margin-bottom:10px;}
.arena-title {font-size:clamp(42px,5vw,70px);font-weight:750;letter-spacing:-.055em;line-height:1.06;}
.arena-title span {color:#b5ef64;}
.arena-subtitle {color:#9db0c4;font-size:17px;max-width:780px;margin:18px 0 28px;line-height:1.6;}
[data-testid="stMetricValue"] {color:#b5ef64;}
.stButton button {border-radius:8px;}
div[data-testid="stVerticalBlockBorderWrapper"] {border-color:#26374a;}
header[data-testid="stHeader"] {background:transparent;}
</style>""", unsafe_allow_html=True)

snapshot = Path(os.environ.get("ARENA_SNAPSHOT") or default_fixture())
try:
    manifest = validate_snapshot(snapshot)
except ValueError as error:
    st.error(f"Snapshot validation failed: {error}")
    st.stop()
tools = Tools(snapshot)

with st.sidebar:
    st.markdown("## ◈ ARENA")
    st.caption("THE MATCH INTELLIGENCE LAB")
    sport = st.selectbox("Competition universe", ["football", "valorant"], format_func=str.upper)
    mode_label = st.radio("Analyst engine", ["Local chatbot (Ollama)", "Evidence browser (no LLM)"])
    st.divider()
    st.caption("SNAPSHOT PROVENANCE")
    st.code(manifest["dataset_version"], language=None)
    st.caption(f"Data kind: {manifest['data_kind'].upper()}")
    st.caption(f"Observed through {manifest['as_of'][:16].replace('T', ' ')} UTC")
    st.success("File checksums verified")
    st.caption("No player accounts. No API tokens in chat. Read-only analytical tools.")

st.markdown('<div class="arena-eyebrow">FOOTBALL × VALORANT / DATA → EVIDENCE → PROBABILITIES</div>'
            '<div class="arena-title">Every match has<br>a <span>data story.</span></div>'
            '<div class="arena-subtitle">Explore team form, inspect match forecasts, and ask your local analyst '
            'to explain the evidence. One reproducible lakehouse, two competitive worlds.</div>', unsafe_allow_html=True)
if manifest["data_kind"] == "synthetic":
    st.info("DEMO UNIVERSE · All teams and results are fictional. Forecasts demonstrate the workflow; "
            "they have not been validated on real football or VALORANT matches.")
else:
    st.info("API SNAPSHOT · Data reflects the recorded observation cutoff. Free APIs may delay updates.")

stats = tools.call("get_team_stats", {"sport": sport})["rows"]
matches = tools.call("list_matches", {"sport": sport})["rows"]
forecasts = [p for p in tools.read_json("predictions.json") if p["sport"] == sport]
quality = tools.read_json("quality.json")
metrics = st.columns(4)
metrics[0].metric("Teams tracked", len(stats))
metrics[1].metric("Completed team appearances", sum(r["matches"] for r in stats))
metrics[2].metric("Available match forecasts", len(forecasts))
metrics[3].metric("Quarantined observations", quality["summary"]["quarantined"])

overview, matchups, analyst, health, models = st.tabs(["TEAM FORM", "MATCH FORECASTS", "ASK ARENA", "DATA HEALTH", "MODEL CARDS"])
with overview:
    left, right = st.columns([1.5, 1])
    with left:
        st.subheader("The form table")
        st.caption("Completed matches only. A win rate is descriptive, not a future win probability.")
        if stats:
            frame = pd.DataFrame(stats)[["team_name", "matches", "wins", "draws", "losses", "win_rate"]]
            st.dataframe(frame, hide_index=True, width="stretch", column_config={
                "win_rate": st.column_config.ProgressColumn("Win rate", min_value=0, max_value=1, format="%.3f")})
        else:
            st.warning("No completed-match team history is available yet.")
    with right:
        st.subheader("Win-rate comparison")
        if stats:
            st.bar_chart(pd.DataFrame(stats).set_index("team_name")[["win_rate"]], color="#b5ef64", horizontal=True)
        st.caption("Football draws remain in the denominator. VALORANT scores count maps, not rounds.")
    st.subheader("Recent match observations")
    st.dataframe(pd.DataFrame(matches)[["team_a", "team_b", "status", "score_a", "score_b", "start_time"]]
                 if matches else pd.DataFrame(), hide_index=True, width="stretch")

with matchups:
    st.subheader("A probability distribution, with provenance")
    if not forecasts:
        st.warning("No eligible upcoming-match predictions. Collect more point-in-time history; "
                   "Arena will not invent a forecast.")
    else:
        selected = st.selectbox("Choose a matchup", range(len(forecasts)),
            format_func=lambda i: f"{forecasts[i]['team_a']} vs {forecasts[i]['team_b']}")
        prediction = forecasts[selected]
        with st.container(border=True):
            st.markdown(f"### {prediction['team_a']}  ·  {prediction['team_b']}")
            st.caption(f"Scheduled {prediction['start_time'][:16].replace('T', ' ')} UTC · "
                       f"Model {prediction['model']} · {prediction['data_kind'].upper()}")
            labels = {"a": prediction["team_a"], "draw": "Draw", "b": prediction["team_b"]}
            columns = st.columns(len(prediction["probabilities"]))
            for column, (label, probability) in zip(columns, prediction["probabilities"].items()):
                column.metric(labels[label], f"{probability:.1%}")
            st.caption(prediction["limitations"])
            with st.expander("What was known before this prediction?"):
                st.json(prediction["evidence"])
                st.code(prediction["match_id"], language=None)

with analyst:
    st.subheader("Ask about the match. Inspect the reasoning inputs.")
    st.caption("Try: Explain football prediction methodology · Show VALORANT team win rates · "
               "What data-quality incidents were detected?")
    if "conversation" not in st.session_state:
        st.session_state.conversation = []
    for turn in st.session_state.conversation:
        with st.chat_message(turn["role"]):
            st.markdown(turn["text"])
    question = st.chat_input("Ask Arena about teams, model probabilities or the data pipeline")
    if question:
        st.session_state.conversation.append(dict(role="user", text=question))
        with st.spinner("Reading the verified snapshot and consulting local tools…"):
            try:
                response = httpx.post("http://127.0.0.1:8000/chat", timeout=300,
                    json=dict(question=question, mode="ollama" if mode_label.startswith("Local") else "evidence"))
                response.raise_for_status()
                answer = response.json()
                st.session_state.last_answer = answer
                st.session_state.conversation.append(dict(role="assistant", text=answer["answer"]))
                st.rerun()
            except httpx.HTTPError:
                st.error("The local analyst could not complete this request. Check API logs, start Ollama, "
                         "or select the explicitly labelled evidence-browser mode.")
    if "last_answer" in st.session_state:
        answer = st.session_state.last_answer
        st.caption(f"Trace {answer['trace_id'][:12]} · {answer['metrics']['latency_seconds']:.1f}s · "
                   f"{answer['metrics']['tool_calls']} tools · mode {answer['mode']}")
        with st.expander("Sources and structured tool evidence"):
            st.json(dict(citations=answer["citations"], results=answer["tool_results"]))
        rating = st.radio("Was this answer useful?", ["Not rated", "Yes", "No"], horizontal=True)
        if st.button("Save feedback", disabled=rating == "Not rated"):
            try:
                response = httpx.post("http://127.0.0.1:8000/feedback", timeout=10,
                    json=dict(trace_id=answer["trace_id"], rating=1 if rating == "Yes" else -1))
                response.raise_for_status()
                st.success("Feedback attached to the trace.")
            except httpx.HTTPError:
                st.error("Feedback was not saved; check the local API.")

with health:
    st.subheader("Quality is observable")
    st.json(quality)
    st.dataframe(pd.DataFrame(tools.read_json("incidents.json")), hide_index=True, width="stretch")
    with st.expander("Lineage"):
        st.json(tools.read_json("lineage.json"))

with models:
    st.subheader("Chronological backtests and a simple baseline")
    st.caption("Training, validation and test periods are separate. Synthetic results do not measure real-world accuracy.")
    report = tools.read_json("model_report.json")
    for name, card in report.get("sports", {}).items():
        st.markdown(f"### {name.upper()}")
        if card.get("status") == "evaluated":
            rows = [dict(model=key, **values) for key, values in card["test"].items()]
            st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        with st.expander(f"Full {name} model card"):
            st.json(card)
