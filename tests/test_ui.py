from pathlib import Path

import pytest

AppTest = pytest.importorskip("streamlit.testing.v1").AppTest


def test_dashboard_renders_both_sports_without_exceptions():
    root = Path(__file__).parents[1]
    app = AppTest.from_file(str(root / "src/arena_copilot/ui.py"), default_timeout=30).run()
    assert not app.exception
    assert {"Teams tracked", "Completed team appearances", "Available match forecasts", "Quarantined observations"} <= {m.label for m in app.metric}
    app.sidebar.selectbox[0].set_value("valorant").run()
    assert not app.exception
    assert {"Teams tracked", "Completed team appearances", "Available match forecasts", "Quarantined observations"} <= {m.label for m in app.metric}
