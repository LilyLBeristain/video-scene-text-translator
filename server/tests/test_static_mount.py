"""Tests for the SPA static-file mount (plan.md Step 15, D9).

In production/demo, FastAPI serves the built React bundle at ``/`` via
``StaticFiles`` so the whole app lives on a single port. In dev (Vite on
:5173) the bundle isn't built and there's no ``server/app/static/``
directory — in that case we expose a dev hint route so hitting ``/``
doesn't just 404.

To keep these tests simple and deterministic we avoid reload-per-test
tricks and instead exercise the ``_mount_spa`` helper directly against
a freshly-built ``FastAPI`` app. The module-level wiring in ``main.py``
is a single call to the same helper, so covering the helper covers
the wiring.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.app.main import _mount_spa
from server.app.routes import router


def _make_app(static_dir: Path) -> FastAPI:
    """Build an app with the API router + the SPA mount wired against `static_dir`.

    Mirrors ``main.py``'s module-level wiring minus the JobManager lifespan
    (these tests only hit routes that don't depend on the manager:
    ``GET /api/health`` and the static mount).
    """
    app = FastAPI()
    app.include_router(router)

    @app.get("/api/health")
    def health() -> dict[str, str]:  # mirror main.py
        return {"status": "ok"}

    _mount_spa(app, static_dir)
    return app


def _write_fake_bundle(static_dir: Path) -> None:
    """Drop an ``index.html`` + ``assets/app.js`` to simulate ``vite build``."""
    static_dir.mkdir(parents=True, exist_ok=True)
    (static_dir / "index.html").write_text(
        "<!doctype html><title>fake</title>"
    )
    (static_dir / "assets").mkdir(exist_ok=True)
    (static_dir / "assets" / "app.js").write_text("console.log('hi');")


def test_static_root_serves_index_html_when_present(tmp_path: Path) -> None:
    """With static/ present, GET / returns the built index.html."""
    static_dir = tmp_path / "static"
    _write_fake_bundle(static_dir)
    app = _make_app(static_dir)

    with TestClient(app) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "<title>fake</title>" in resp.text


def test_static_asset_served(tmp_path: Path) -> None:
    """Hashed asset under /assets/* is served from the static bundle."""
    static_dir = tmp_path / "static"
    _write_fake_bundle(static_dir)
    app = _make_app(static_dir)

    with TestClient(app) as client:
        resp = client.get("/assets/app.js")
        assert resp.status_code == 200
        assert "console.log" in resp.text


def test_api_routes_still_work_when_static_mounted(tmp_path: Path) -> None:
    """The /api/* routes must not be shadowed by the root static mount."""
    static_dir = tmp_path / "static"
    _write_fake_bundle(static_dir)
    app = _make_app(static_dir)

    with TestClient(app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_dev_hint_returned_when_no_static_dir(tmp_path: Path) -> None:
    """If static/ doesn't exist, GET / returns a JSON dev hint (not a 404)."""
    missing_static = tmp_path / "does-not-exist"
    assert not missing_static.exists()
    app = _make_app(missing_static)

    with TestClient(app) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        body = resp.json()
        assert "SPA not built" in body.get("message", "")
