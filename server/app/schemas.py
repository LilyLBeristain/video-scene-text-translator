"""Pydantic request/response models and SSE event types (plan.md D2, D11).

Pydantic v2 style throughout: `BaseModel`, `Field`, `ConfigDict`, `model_validate`,
`model_dump`. Stage/status/level fields use `typing.Literal` rather than `Enum`
so they serialize to plain strings that mirror the TS definitions in
`web/src/api/schemas.ts` one-to-one (R7).

Event models set `extra="forbid"` so drift between the Pydantic surface and the
TS mirror surfaces as parse errors at review time rather than as silent data loss.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from server.app.languages import SUPPORTED_CODES

# ---------------------------------------------------------------------------
# Literals shared across the API surface. Keep in sync with web/src/api/schemas.ts.
# ---------------------------------------------------------------------------

Stage = Literal["s1", "s2", "s3", "s4", "s5"]
JobStatusLiteral = Literal["queued", "running", "succeeded", "failed"]
LogLevel = Literal["info", "warning", "error"]


# ---------------------------------------------------------------------------
# Job request / response models
# ---------------------------------------------------------------------------


class JobCreateForm(BaseModel):
    """Validated view of the non-file fields of `POST /api/jobs`.

    The real endpoint takes multipart/form-data (video file + these two
    string fields) — FastAPI's `Form(...)` parameters can't be expressed as a
    single Pydantic model cleanly, so this class is used for language-code
    validation in isolation (e.g. by the route handler, or in tests).
    """

    source_lang: str
    target_lang: str

    @field_validator("source_lang", "target_lang")
    @classmethod
    def _lang_must_be_supported(cls, v: str) -> str:
        if v not in SUPPORTED_CODES:
            raise ValueError(
                f"unsupported language code {v!r}; "
                f"must be one of {sorted(SUPPORTED_CODES)}"
            )
        return v


class JobCreateResponse(BaseModel):
    """Response body for `POST /api/jobs`."""

    job_id: str  # UUID4 as a string


class JobStatus(BaseModel):
    """Response body for `GET /api/jobs/{job_id}/status`."""

    job_id: str
    status: JobStatusLiteral
    source_lang: str
    target_lang: str
    created_at: float
    current_stage: Stage | None = None
    finished_at: float | None = None
    error: str | None = None
    output_available: bool = False


# ---------------------------------------------------------------------------
# SSE events — one model per event type, plus a tagged union.
# ---------------------------------------------------------------------------


class StageStartEvent(BaseModel):
    """Pipeline has entered a new stage."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["stage_start"] = "stage_start"
    stage: Stage
    ts: float


class StageCompleteEvent(BaseModel):
    """Pipeline has finished a stage; carries elapsed wall time in ms."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["stage_complete"] = "stage_complete"
    stage: Stage
    duration_ms: float
    ts: float


class LogEvent(BaseModel):
    """A single log record forwarded from the pipeline logger."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["log"] = "log"
    level: LogLevel
    message: str
    ts: float


class DoneEvent(BaseModel):
    """Terminal success event — output is ready at `output_url`."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["done"] = "done"
    output_url: str
    ts: float


class ErrorEvent(BaseModel):
    """Terminal failure event."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["error"] = "error"
    message: str
    ts: float
    traceback: str | None = None


# Tagged union — Pydantic v2 resolves the member by the shared literal `type`
# field automatically when validated via TypeAdapter.
SSEEvent = (
    StageStartEvent | StageCompleteEvent | LogEvent | DoneEvent | ErrorEvent
)
