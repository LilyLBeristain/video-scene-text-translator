"""Server integration smoke tests — real pipeline, real AnyText2, real GPU.

These tests are marked ``gpu`` and skip automatically when:
  - CUDA GPU is unavailable (``torch.cuda.is_available()`` is False)
  - AnyText2 server URL from ``adv.yaml`` is not reachable
  - required test assets are missing

They are excluded by default via ``addopts = -m "not gpu"`` in
``server/pytest.ini``. To run explicitly::

    cd server && python -m pytest tests/test_integration.py -v -m gpu

What these tests cover (and the mocked suite in ``test_api.py`` cannot)
----------------------------------------------------------------------

* FastAPI multipart upload → ``storage.uploads_dir`` landing on disk
* ``JobManager`` → ``ThreadPoolExecutor`` → real ``run_pipeline_job``
* ``_PipelineLogHandler`` capturing real ``src.*`` pipeline logs
* ``progress_callback`` emitting real ``stage_N_start`` / ``stage_N_done``
* Output MP4 written by OpenCV ``VideoWriter``
* Browser codec compatibility (plan.md R3)

Two test scenarios are built:

* **Plumbing smoke** — uploads ``apple.mp4`` (50 frames, 1296x720, no
  scene text). The pipeline is expected to take the "no tracks found"
  short-circuit path (``code/src/pipeline.py:68-79``) so only S1 fires;
  the remaining stages are not exercised. This is low-flake and proves
  every wire in the chain is connected.

* **Full-stack smoke** — synthesizes a short "HELLO WORLD" clip and
  runs it through the entire S1→S5 stack (PaddleOCR → AnyText2 → Hi-SAM
  → revert). If PaddleOCR doesn't detect the synthesized text the test
  skips — this is a wiring test, not a correctness test for the ML
  stages.
"""

from __future__ import annotations

import json
import socket
import time
from collections.abc import Iterable
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import pytest
import yaml
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Paths to repo-local assets
# ---------------------------------------------------------------------------

# server/tests/test_integration.py  →  parents[2]  =  <repo_root>
REPO_ROOT = Path(__file__).resolve().parents[2]
ADV_YAML = REPO_ROOT / "code" / "config" / "adv.yaml"
APPLE_VIDEO = REPO_ROOT / "third_party" / "co-tracker" / "assets" / "apple.mp4"


# ---------------------------------------------------------------------------
# Skip gating — guarantees these tests never fail spuriously because of a
# missing GPU or a down AnyText2 server. Run as an autouse fixture so every
# test in this module gets the check without repetition.
# ---------------------------------------------------------------------------


def _server_reachable(url: str, timeout: float = 3.0) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        # socket.timeout is a subclass of OSError, so this catches both.
        return False


def _get_anytext2_url() -> str:
    if not ADV_YAML.exists():
        return ""
    data = yaml.safe_load(ADV_YAML.read_text()) or {}
    return data.get("text_editor", {}).get("server_url", "") or ""


@pytest.fixture(autouse=True)
def require_env():
    """Skip all integration tests if GPU or AnyText2 server is unavailable."""
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("CUDA GPU unavailable")
    url = _get_anytext2_url()
    if not url:
        pytest.skip("No AnyText2 server_url in adv.yaml")
    if not _server_reachable(url):
        pytest.skip(f"AnyText2 unreachable at {url}")


@pytest.fixture(autouse=True)
def reset_sse_starlette_app_status():
    """Clear sse-starlette's module-global ``AppStatus`` between tests.

    ``sse_starlette.sse.AppStatus.should_exit_event`` is lazily created
    as an ``anyio.Event`` on the first SSE request and bound to the
    event loop that served it. ``TestClient`` spins up a fresh loop per
    ``with TestClient(...)`` block, so the second test reusing the same
    process trips over a "bound to a different event loop" error. Resetting
    the module-global before and after each test dodges this cleanly.
    """
    from sse_starlette import sse as _sse  # local import — optional dep

    _sse.AppStatus.should_exit_event = None
    _sse.AppStatus.should_exit = False
    yield
    _sse.AppStatus.should_exit_event = None
    _sse.AppStatus.should_exit = False


# ---------------------------------------------------------------------------
# SSE + MP4 helpers
# ---------------------------------------------------------------------------


def _parse_sse_stream(resp) -> list[dict]:
    """Parse an SSE streaming response into a list of ``{event, data}`` frames.

    Mirrors the parser in ``test_api.py`` — SSE frames are blank-line
    separated, and we ignore ``id``, ``retry``, and comment (``: ...``)
    lines since the server doesn't emit them in a way we care about.
    """
    frames: list[dict] = []
    current: dict = {}
    for raw in resp.iter_lines():
        line = raw if isinstance(raw, str) else raw.decode("utf-8")
        if line == "":
            if current:
                frames.append(current)
                current = {}
            continue
        if line.startswith(":"):
            continue  # sse-starlette ping/comment
        if line.startswith("event:"):
            current["event"] = line[len("event:") :].strip()
        elif line.startswith("data:"):
            current["data"] = line[len("data:") :].strip()
    if current:
        frames.append(current)
    return frames


def _read_mp4_fourcc(path: Path) -> str:
    """Return the fourcc tag of an MP4 (for the plan.md R3 browser check)."""
    cap = cv2.VideoCapture(str(path))
    try:
        code = int(cap.get(cv2.CAP_PROP_FOURCC))
    finally:
        cap.release()
    return bytes([(code >> (8 * i)) & 0xFF for i in range(4)]).decode(
        "ascii", errors="replace"
    )


# Accept any of these codecs as "browser-playable" for <video>. ``mp4v`` is
# MPEG-4 Part 2 — Chrome and Firefox decode it for most sources, but some
# mobile browsers won't. If this test fails on ``mp4v`` in a real browser
# we'll need to add an ffmpeg-transcode step to ``run_pipeline_job`` per
# plan.md R3. That decision is deferred until the smoke run actually shows
# us which codec OpenCV is writing on this box.
_BROWSER_PLAYABLE_FOURCCS = frozenset({"avc1", "h264", "mp4v"})


def _is_browser_playable_fourcc(fourcc: str) -> bool:
    return fourcc.lower().strip("\x00 ") in _BROWSER_PLAYABLE_FOURCCS


def _make_text_video(path: Path, *, n_frames: int = 30, fps: float = 30.0) -> None:
    """Render a short clip of "HELLO WORLD" on a gray background.

    Used by the full-stack smoke test. Synthesizes something that
    PaddleOCR can plausibly pick up so the whole pipeline fires.
    """
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (640, 360))
    try:
        for _ in range(n_frames):
            frame = np.full((360, 640, 3), 80, dtype=np.uint8)
            cv2.putText(
                frame,
                "HELLO WORLD",
                (100, 200),
                cv2.FONT_HERSHEY_SIMPLEX,
                2.0,
                (255, 255, 255),
                3,
                cv2.LINE_AA,
            )
            writer.write(frame)
    finally:
        writer.release()


@contextmanager
def _real_client(tmp_storage: Path, monkeypatch: pytest.MonkeyPatch):
    """Yield a TestClient bound to the real server.app.main app + tmp storage.

    We deliberately use the real ``main.app`` (not a test-local app factory)
    so this test exercises the lifespan hook that wires the real
    ``run_pipeline_job`` runner — which is the whole point of this
    integration suite. ``SERVER_STORAGE_ROOT`` is read on every storage
    call, so setting it via ``monkeypatch`` before building the client
    redirects both uploads and outputs to ``tmp_storage``.
    """
    monkeypatch.setenv("SERVER_STORAGE_ROOT", str(tmp_storage))
    # Import inside the helper so ``require_env`` can skip before we touch
    # the real app (which pulls in torch etc. via the runner).
    from server.app.main import app  # noqa: PLC0415

    with TestClient(app) as client:
        yield client


def _drain_sse(
    client: TestClient,
    job_id: str,
    *,
    timeout: float = 600.0,
) -> dict:
    """Subscribe to ``/events`` and collect every frame until done/error.

    Returns a dict with ``events`` (list of raw ``{event, data}`` frames),
    ``stages_started``, ``stages_completed``, ``logs`` (list of LogEvent
    dicts), and ``terminal`` (``"done"``, ``"error"``, or ``None`` if the
    stream closed without one). Times out loudly rather than hanging.
    """
    events: list[dict] = []
    stages_started: set[str] = set()
    stages_completed: set[str] = set()
    logs: list[dict] = []
    terminal: str | None = None

    with client.stream(
        "GET", f"/api/jobs/{job_id}/events", timeout=timeout
    ) as resp:
        assert resp.status_code == 200, resp.read()
        for frame in _parse_sse_stream(resp):
            events.append(frame)
            ev_type = frame.get("event")
            data_raw = frame.get("data", "")
            data = json.loads(data_raw) if data_raw else {}
            if ev_type == "stage_start":
                stages_started.add(data["stage"])
            elif ev_type == "stage_complete":
                stages_completed.add(data["stage"])
            elif ev_type == "log":
                logs.append(data)
            elif ev_type == "done":
                terminal = "done"
                break
            elif ev_type == "error":
                terminal = "error"
                # Store the payload on the dict for post-mortem assertions.
                data["__error_data__"] = True
                events[-1]["parsed"] = data
                break

    return {
        "events": events,
        "stages_started": stages_started,
        "stages_completed": stages_completed,
        "logs": logs,
        "terminal": terminal,
    }


def _find_error_message(events: Iterable[dict]) -> str:
    for frame in events:
        if frame.get("event") == "error":
            try:
                return json.loads(frame.get("data", "{}")).get("message", "")
            except json.JSONDecodeError:
                return frame.get("data", "")
    return ""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.gpu
def test_server_runs_real_pipeline_plumbing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Real pipeline against a no-text clip — wiring smoke test.

    Asserts:
      * Upload + job submit succeed.
      * SSE stream yields at least a ``stage_start`` for ``s1`` and a
        terminal ``done`` event.
      * Output MP4 downloads, is non-empty, has the expected frame count.
      * The fourcc OpenCV wrote matches a browser-playable codec (R3).
    """
    if not APPLE_VIDEO.exists():
        pytest.skip(f"Missing test video: {APPLE_VIDEO}")

    storage_root = tmp_path / "storage"
    with _real_client(storage_root, monkeypatch) as client:
        with APPLE_VIDEO.open("rb") as f:
            resp = client.post(
                "/api/jobs",
                files={"video": ("apple.mp4", f, "video/mp4")},
                data={"source_lang": "en", "target_lang": "es"},
            )
        assert resp.status_code == 200, resp.text
        job_id = resp.json()["job_id"]

        result = _drain_sse(client, job_id, timeout=900.0)

        assert result["terminal"] != "error", (
            f"pipeline errored: {_find_error_message(result['events'])}"
        )
        assert result["terminal"] == "done", (
            "SSE stream closed without a done event; "
            f"frames={result['events'][-5:]}"
        )
        assert "s1" in result["stages_started"], (
            f"S1 never started; stages seen: {result['stages_started']}"
        )

        # Give the worker a moment to finish writing the output file. The
        # DoneEvent is emitted after VideoWriter close, so the file *should*
        # already be there, but a tiny filesystem-sync delay is possible.
        deadline = time.monotonic() + 5.0
        dl = None
        while time.monotonic() < deadline:
            dl = client.get(f"/api/jobs/{job_id}/output")
            if dl.status_code == 200:
                break
            time.sleep(0.05)
        assert dl is not None and dl.status_code == 200, (
            dl.text if dl is not None else "no download response"
        )
        assert dl.headers["content-type"] == "video/mp4"
        assert len(dl.content) > 0, "output file is empty"

        out_path = tmp_path / "out.mp4"
        out_path.write_bytes(dl.content)

        # R3: verify the output codec is something a browser can decode.
        fourcc = _read_mp4_fourcc(out_path)
        assert _is_browser_playable_fourcc(fourcc), (
            f"Output fourcc {fourcc!r} may not play in <video>. "
            f"Add an ffmpeg transcode to pipeline_runner per plan.md R3."
        )

        # Frame count matches input — pipeline's no-track short circuit
        # writes every input frame unchanged.
        in_cap = cv2.VideoCapture(str(APPLE_VIDEO))
        in_frames = int(in_cap.get(cv2.CAP_PROP_FRAME_COUNT))
        in_cap.release()
        out_cap = cv2.VideoCapture(str(out_path))
        out_frames = int(out_cap.get(cv2.CAP_PROP_FRAME_COUNT))
        out_cap.release()
        assert out_frames == in_frames, (
            f"frame count mismatch: in={in_frames}, out={out_frames}"
        )


@pytest.mark.gpu
def test_server_runs_real_pipeline_on_synthetic_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Real pipeline against a synthesized text clip — full-stack smoke.

    If PaddleOCR doesn't detect the synthetic text we skip rather than
    fail — this is a wiring test, not an ML correctness test. The
    plumbing test covers the baseline happy path.
    """
    src_video = tmp_path / "hello.mp4"
    _make_text_video(src_video)

    storage_root = tmp_path / "storage"
    with _real_client(storage_root, monkeypatch) as client:
        with src_video.open("rb") as f:
            resp = client.post(
                "/api/jobs",
                files={"video": ("hello.mp4", f, "video/mp4")},
                data={"source_lang": "en", "target_lang": "es"},
            )
        assert resp.status_code == 200, resp.text
        job_id = resp.json()["job_id"]

        result = _drain_sse(client, job_id, timeout=900.0)

        assert result["terminal"] != "error", (
            f"pipeline errored: {_find_error_message(result['events'])}"
        )
        assert result["terminal"] == "done"

        # Only assert the full S1→S5 sweep fired if S2 actually started —
        # that's the signal that S1 found at least one text track. When
        # PaddleOCR misses the synthetic text we get the no-track short
        # circuit (S1 only) and skip with a diagnostic.
        if "s2" not in result["stages_started"]:
            pytest.skip(
                f"PaddleOCR didn't detect synthetic text; only stages "
                f"{result['stages_started']} fired. Plumbing test covers "
                f"the wiring path."
            )

        assert result["stages_started"] == {"s1", "s2", "s3", "s4", "s5"}, (
            f"not all stages started: {result['stages_started']}"
        )
        assert result["stages_completed"] == {"s1", "s2", "s3", "s4", "s5"}, (
            f"not all stages completed: {result['stages_completed']}"
        )
        assert len(result["logs"]) > 0, "no log events captured during real run"

        dl = client.get(f"/api/jobs/{job_id}/output")
        assert dl.status_code == 200
        assert len(dl.content) > 0

        out_path = tmp_path / "out.mp4"
        out_path.write_bytes(dl.content)
        fourcc = _read_mp4_fourcc(out_path)
        assert _is_browser_playable_fourcc(fourcc), (
            f"non-browser fourcc {fourcc!r}"
        )


@pytest.mark.gpu
def test_output_mp4_has_video_track_and_correct_dimensions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """The output MP4 is actually a readable video track with matching dims.

    Belt-and-braces check on top of the plumbing test: we decode the first
    frame of the output and compare its resolution to the input. Catches
    the case where VideoWriter happily produces a container with a broken
    or empty video track.
    """
    if not APPLE_VIDEO.exists():
        pytest.skip(f"Missing test video: {APPLE_VIDEO}")

    storage_root = tmp_path / "storage"
    with _real_client(storage_root, monkeypatch) as client:
        with APPLE_VIDEO.open("rb") as f:
            resp = client.post(
                "/api/jobs",
                files={"video": ("apple.mp4", f, "video/mp4")},
                data={"source_lang": "en", "target_lang": "es"},
            )
        assert resp.status_code == 200, resp.text
        job_id = resp.json()["job_id"]

        result = _drain_sse(client, job_id, timeout=900.0)
        assert result["terminal"] == "done", (
            f"pipeline didn't finish: {_find_error_message(result['events'])}"
        )

        dl = client.get(f"/api/jobs/{job_id}/output")
        assert dl.status_code == 200
        out_path = tmp_path / "out.mp4"
        out_path.write_bytes(dl.content)

        in_cap = cv2.VideoCapture(str(APPLE_VIDEO))
        in_w = int(in_cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        in_h = int(in_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        in_cap.release()

        out_cap = cv2.VideoCapture(str(out_path))
        out_w = int(out_cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        out_h = int(out_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ret, first_frame = out_cap.read()
        out_cap.release()

        assert ret, "couldn't read first frame of output MP4"
        assert first_frame is not None
        assert first_frame.shape[:2] == (in_h, in_w), (
            f"dim mismatch: first frame {first_frame.shape[:2]} vs "
            f"input ({in_h}, {in_w})"
        )
        assert (out_w, out_h) == (in_w, in_h), (
            f"container dim mismatch: out=({out_w}x{out_h}) vs "
            f"in=({in_w}x{in_h})"
        )
