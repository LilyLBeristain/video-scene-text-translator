"""FastAPI application entry point (plan.md Step 7 + Step 15).

Lifecycle
---------

On startup (``lifespan`` context):

1. Sweep stale job directories older than the TTL (plan.md D7).
2. Instantiate a single ``JobManager`` bound to the real
   ``run_pipeline_job`` runner and stash it on ``app.state`` so routes
   can depend-inject it via ``get_manager``.

On shutdown: ``JobManager.shutdown()`` so the worker thread exits cleanly
and there are no dangling futures when uvicorn tears down.

The ``JobManager`` constructor calls ``asyncio.get_running_loop()`` to
capture the loop for ``call_soon_threadsafe`` — that's why it's built
*inside* the lifespan (which runs on the event loop) rather than at
import time.

Static SPA mount (plan.md Step 15, D9)
--------------------------------------

In production/demo the built React bundle lives under
``server/app/static/`` (copied there by ``scripts/build_frontend.sh``).
We mount it at ``/`` *after* the API router so ``/api/*`` isn't
shadowed by the static handler. If the directory is absent (dev mode —
Vite serves the bundle on :5173 and proxies ``/api``) we install a
helpful JSON hint on ``/`` instead of leaving it as a 404.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import storage
from .jobs import JobManager
from .pipeline_runner import run_pipeline_job
from .routes import get_manager, router

logger = logging.getLogger(__name__)

# Resolved once at import time; tests build their own ``STATIC_DIR`` and
# call ``_mount_spa`` against a fresh app so they don't depend on this
# module-level value.
STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Wire shared state onto the running event loop."""
    # (a) Purge stale job directories (> 2h). Defensive: a previous server
    # crash could have left data lying around.
    swept = storage.sweep_old_jobs(ttl_hours=2.0)
    if swept:
        logger.info("swept %d stale job dir(s) on startup", len(swept))

    # (b) Build the manager inside the loop so it captures it via
    # asyncio.get_running_loop() for thread-safe queue puts.
    manager = JobManager(runner=run_pipeline_job)
    app.state.job_manager = manager

    # Override the dependency provider to hand out this manager.
    app.dependency_overrides[get_manager] = lambda: app.state.job_manager

    try:
        yield
    finally:
        # (c) Clean shutdown — stop the worker thread.
        manager.shutdown(wait=True)


def _mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Mount the built React bundle at ``/`` — or a dev hint if absent.

    Must be called *after* ``app.include_router(router)`` so the root
    ``StaticFiles`` mount doesn't shadow ``/api/*``. ``html=True`` makes
    ``StaticFiles`` serve ``index.html`` for directory-style requests
    (including ``/`` itself), which is all the single-view MVP needs.

    The MVP has no client-side routes beyond ``/`` so we deliberately
    skip a catch-all that re-serves ``index.html`` for unknown paths.
    Adding one later is a one-liner but not needed today.
    """
    if static_dir.exists():
        app.mount(
            "/",
            StaticFiles(directory=str(static_dir), html=True),
            name="static",
        )
        logger.info("mounted SPA bundle at / from %s", static_dir)
    else:
        # Dev fallback — Vite serves the SPA on :5173 and proxies /api.
        # Hitting the FastAPI port's / directly gets a helpful hint
        # instead of a 404, which is confusing for first-time contributors.
        @app.get("/")
        def _dev_hint() -> dict[str, str]:
            return {
                "message": (
                    "SPA not built. Run ./server/scripts/build_frontend.sh "
                    "or use dev mode (Vite on :5173)."
                ),
            }

        logger.info("SPA static dir %s not found — installed dev hint on /", static_dir)


app = FastAPI(title="Video Scene Text Translator", lifespan=lifespan)

app.include_router(router)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness probe. Returns {"status": "ok"}."""
    return {"status": "ok"}


# Mount the SPA bundle LAST so it doesn't shadow /api/*.
# No CORS middleware — same-origin in prod; dev uses Vite proxy. (D9)
_mount_spa(app, STATIC_DIR)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server.app.main:app", host="0.0.0.0", port=8000, reload=False)
