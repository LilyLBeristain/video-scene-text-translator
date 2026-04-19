"""Filesystem layout for per-job uploads and outputs.

Layout:
    <storage_root>/uploads/<job_id>/<original_name>.mp4
    <storage_root>/outputs/<job_id>/out.mp4

`storage_root` defaults to `<repo>/server/storage/` but can be overridden via
the `SERVER_STORAGE_ROOT` env var (used by tests and alternative deployments).
The env var is re-read on every call so `monkeypatch.setenv` in tests works
without any cache invalidation dance. See plan.md D7.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# <repo>/server/storage/ — this file lives at server/app/storage.py, so parents[2] is <repo>/server/.
_DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "storage"


def storage_root() -> Path:
    """Return the canonical storage root, honoring `SERVER_STORAGE_ROOT` if set."""
    override = os.environ.get("SERVER_STORAGE_ROOT")
    return Path(override) if override else _DEFAULT_ROOT


def uploads_dir(job_id: str) -> Path:
    """Return (and create) the uploads directory for `job_id`."""
    path = storage_root() / "uploads" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def outputs_dir(job_id: str) -> Path:
    """Return (and create) the outputs directory for `job_id`."""
    path = storage_root() / "outputs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def cleanup_job(job_id: str) -> None:
    """Remove uploads + outputs for `job_id`. No-op if the dirs don't exist."""
    root = storage_root()
    for sub in ("uploads", "outputs"):
        path = root / sub / job_id
        if path.exists():
            shutil.rmtree(path)
            logger.info("Removed %s", path)


def sweep_old_jobs(ttl_hours: float = 2.0) -> list[str]:
    """Purge job dirs older than `ttl_hours` from uploads/ and outputs/.

    Returns the deduplicated list of swept job_ids **sorted lexicographically**
    — `iterdir()` order is filesystem-dependent; sorting keeps the return
    value stable across platforms + easy to assert in tests. Safe to call
    before the storage root exists (returns `[]` without creating it).
    """
    root = storage_root()
    if not root.exists():
        return []

    cutoff = time.time() - ttl_hours * 3600
    seen: set[str] = set()

    for sub in ("uploads", "outputs"):
        parent = root / sub
        if not parent.exists():
            continue
        for job_path in parent.iterdir():
            if not job_path.is_dir():
                continue
            if job_path.stat().st_mtime < cutoff:
                shutil.rmtree(job_path)
                logger.info("Swept stale job dir %s", job_path)
                seen.add(job_path.name)

    return sorted(seen)
