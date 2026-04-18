"""Tests for server.app.schemas and server.app.languages.

Covers the curated language list (D12), the Pydantic request/response models,
and the SSE event discriminated union (D11). Kept purely in-process — no
FastAPI TestClient needed.
"""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from server.app.languages import SUPPORTED_LANGUAGES, is_supported
from server.app.schemas import (
    DoneEvent,
    ErrorEvent,
    JobCreateForm,
    JobStatus,
    LogEvent,
    SSEEvent,
    StageCompleteEvent,
    StageStartEvent,
)

# -------------------- languages.py --------------------


def test_language_list_has_curated_7():
    # Assert — exactly the 7 curated codes from plan.md D12
    assert len(SUPPORTED_LANGUAGES) == 7
    codes = {lang.code for lang in SUPPORTED_LANGUAGES}
    assert codes == {"en", "es", "zh-cn", "fr", "de", "ja", "ko"}


def test_is_supported():
    # Assert — known code True, unknown False
    assert is_supported("en") is True
    assert is_supported("xx") is False


# -------------------- JobCreateForm (language validation) --------------------


def test_job_create_form_accepts_valid_langs():
    # Act
    form = JobCreateForm(source_lang="en", target_lang="es")

    # Assert
    assert form.source_lang == "en"
    assert form.target_lang == "es"


def test_job_create_form_rejects_unknown_target_lang():
    # Act / Assert — target side invalid
    with pytest.raises(ValidationError) as excinfo:
        JobCreateForm(source_lang="en", target_lang="klingon")
    assert "klingon" in str(excinfo.value) or "target_lang" in str(excinfo.value)


def test_job_create_form_rejects_unknown_source_lang():
    # Act / Assert — source side invalid
    with pytest.raises(ValidationError) as excinfo:
        JobCreateForm(source_lang="klingon", target_lang="en")
    assert "klingon" in str(excinfo.value) or "source_lang" in str(excinfo.value)


# -------------------- SSE events --------------------


def test_stage_start_event_serializes():
    # Arrange
    ev = StageStartEvent(stage="s1", ts=123.4)

    # Act — round-trip
    payload = ev.model_dump()
    restored = StageStartEvent.model_validate(payload)

    # Assert — includes the literal tag + round-trips cleanly
    assert payload["type"] == "stage_start"
    assert payload["stage"] == "s1"
    assert payload["ts"] == 123.4
    assert restored == ev


def test_stage_complete_event_requires_duration_ms():
    # Act / Assert — dropping duration_ms must error (extra=forbid + required)
    with pytest.raises(ValidationError):
        StageCompleteEvent(stage="s2", ts=1.0)  # type: ignore[call-arg]


def test_log_event_level_literal():
    # Act / Assert — only info/warning/error allowed; "debug" must reject.
    with pytest.raises(ValidationError):
        LogEvent(level="debug", message="x", ts=1.0)  # type: ignore[arg-type]


def test_error_event_traceback_optional():
    # Act
    ev = ErrorEvent(message="boom", ts=1.0)

    # Assert
    assert ev.traceback is None
    assert ev.type == "error"


def test_sse_event_discriminated_union():
    # Arrange — validate a "done"-shaped dict against the union.
    adapter = TypeAdapter(SSEEvent)
    payload = {"type": "done", "output_url": "/api/jobs/abc/output", "ts": 1.0}

    # Act
    parsed = adapter.validate_python(payload)

    # Assert — union resolves by the "type" tag to the right concrete class.
    assert isinstance(parsed, DoneEvent)
    assert parsed.output_url == "/api/jobs/abc/output"


# -------------------- JobStatus --------------------


def test_job_status_defaults():
    # Act — only the required fields
    status = JobStatus(
        job_id="abc",
        status="queued",
        source_lang="en",
        target_lang="es",
        created_at=1.0,
    )

    # Assert — all optional fields default to their plan-specified values
    assert status.current_stage is None
    assert status.finished_at is None
    assert status.error is None
    assert status.output_available is False
