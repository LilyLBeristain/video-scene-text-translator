"""Tests for server.app.storage — paths, cleanup, TTL sweep.

Each test uses the `tmp_path` fixture + `monkeypatch.setenv("SERVER_STORAGE_ROOT", ...)`
to redirect storage to an isolated tmpdir. `storage.py` re-reads the env var on
every call so monkeypatching works without cache invalidation.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from server.app import storage


@pytest.fixture
def tmp_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect SERVER_STORAGE_ROOT to an isolated tmpdir."""
    monkeypatch.setenv("SERVER_STORAGE_ROOT", str(tmp_path))
    return tmp_path


def test_uploads_dir_creates_and_returns_path(tmp_storage: Path):
    # Act
    path = storage.uploads_dir("abc-123")

    # Assert
    assert path == tmp_storage / "uploads" / "abc-123"
    assert path.exists()
    assert path.is_dir()

    # Idempotent — second call must not raise.
    path2 = storage.uploads_dir("abc-123")
    assert path2 == path


def test_outputs_dir_creates_and_returns_path(tmp_storage: Path):
    # Act
    path = storage.outputs_dir("abc-123")

    # Assert
    assert path == tmp_storage / "outputs" / "abc-123"
    assert path.exists()
    assert path.is_dir()

    # Idempotent — second call must not raise.
    path2 = storage.outputs_dir("abc-123")
    assert path2 == path


def test_cleanup_job_removes_both_dirs(tmp_storage: Path):
    # Arrange — populate uploads and outputs for a job
    job_id = "job-xyz"
    up = storage.uploads_dir(job_id)
    out = storage.outputs_dir(job_id)
    (up / "video.mp4").write_bytes(b"dummy")
    (out / "out.mp4").write_bytes(b"dummy")

    # Act
    storage.cleanup_job(job_id)

    # Assert — job subdirs gone, parent dirs preserved
    assert not up.exists()
    assert not out.exists()
    assert (tmp_storage / "uploads").exists()
    assert (tmp_storage / "outputs").exists()


def test_cleanup_job_is_idempotent_on_missing_dirs(tmp_storage: Path):
    # Act / Assert — must not raise even though nothing exists
    storage.cleanup_job("nonexistent")


def test_sweep_removes_jobs_older_than_ttl(tmp_storage: Path):
    # Arrange — create two jobs in both uploads and outputs
    for job_id in ("old", "fresh"):
        storage.uploads_dir(job_id)
        storage.outputs_dir(job_id)

    # Backdate "old" by 3 hours in both trees
    past = time.time() - 3 * 3600
    for sub in ("uploads", "outputs"):
        old_path = tmp_storage / sub / "old"
        os.utime(old_path, (past, past))

    # Act
    swept = storage.sweep_old_jobs(ttl_hours=2.0)

    # Assert
    assert swept == ["old"]
    assert not (tmp_storage / "uploads" / "old").exists()
    assert not (tmp_storage / "outputs" / "old").exists()
    assert (tmp_storage / "uploads" / "fresh").exists()
    assert (tmp_storage / "outputs" / "fresh").exists()


def test_sweep_handles_missing_storage_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Arrange — point at a path that does not exist
    missing = tmp_path / "does-not-exist"
    monkeypatch.setenv("SERVER_STORAGE_ROOT", str(missing))
    assert not missing.exists()

    # Act
    swept = storage.sweep_old_jobs()

    # Assert
    assert swept == []
    # Still doesn't exist — sweep should not create it.
    assert not missing.exists()


def test_sweep_respects_custom_ttl(tmp_storage: Path):
    # Arrange — one job, 60-second-old mtime; ttl 0.01h (36s) → should be swept.
    job_id = "short-lived"
    storage.uploads_dir(job_id)
    storage.outputs_dir(job_id)

    one_min_ago = time.time() - 60
    for sub in ("uploads", "outputs"):
        os.utime(tmp_storage / sub / job_id, (one_min_ago, one_min_ago))

    # Act
    swept = storage.sweep_old_jobs(ttl_hours=0.01)

    # Assert
    assert swept == [job_id]
    assert not (tmp_storage / "uploads" / job_id).exists()
    assert not (tmp_storage / "outputs" / job_id).exists()
