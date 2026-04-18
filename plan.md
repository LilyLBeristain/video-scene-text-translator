# Plan: Web Client for Cross-Language Scene Text Replacement

## Goal
Wrap the existing `VideoPipeline` CLI as a browser-based web application for the presentation live demo: user uploads a video, picks source/target languages, watches per-stage progress with live log output, and downloads the result. Single FastAPI process serves the React SPA and API; pipeline runs in-process on one worker thread; deployed to the GPU box behind a Cloudflare Tunnel for demo access.

## Branch
`feat/web-client` (active).

## Scope — strict MVP
**In:**
1. Upload video file (drag-drop or picker)
2. Pick source + target language from a curated dropdown
3. Submit → per-stage progress bar (S1→S5)
4. Live log panel (plain text, auto-scrolling)
5. Error display if the pipeline fails
6. Download output when done

**Out (maybe later):**
- Stage-preview images (debug frames streamed from each stage)
- Job history / re-run past jobs
- Thumbnail preview of uploaded video
- Sample videos library
- Config-knob exposure beyond language
- Auth / multi-user
- Persistent jobs across server restarts

## Approach

### Architecture overview

```
┌─────────────────────────┐
│  Browser                │
│  React + Vite + TS      │
│  Tailwind + shadcn/ui   │
└──────────┬──────────────┘
           │ HTTP + SSE (same origin)
           ▼
┌──────────────────────────────────────────────┐
│  FastAPI (uvicorn) on GPU box                │
│  ├── /api/*    REST + SSE                    │
│  └── /        static React bundle            │
│                                              │
│  JobManager (1 worker thread, in-mem dict)   │
│    │                                         │
│    ▼                                         │
│  PipelineRunner                              │
│    ├── attaches logging.Handler              │
│    │   → asyncio.Queue → SSE                 │
│    ├── passes progress_callback              │
│    │   → VideoPipeline                       │
│    └── calls VideoPipeline(config).run()     │
└──────────┬───────────────────────────────────┘
           │ HTTP
           ▼
┌────────────────────────┐
│  AnyText2 Gradio server│   (already external,
│  (separate process)    │    unchanged)
└────────────────────────┘
```

### Decisions captured

- **D1** Folder layout: `server/` + `web/` at repo root. `code/` (pipeline) stays as-is.
- **D2** Backend: FastAPI + uvicorn. Pydantic schemas → OpenAPI → hand-authored TS schemas for MVP (codegen later if it pays off).
- **D3** Pipeline invocation: **in-process import**, not subprocess. `from src.pipeline import VideoPipeline; pipeline.run()` — runs in a `ThreadPoolExecutor(max_workers=1)` so it doesn't block the FastAPI event loop.
- **D4** Job model: single worker thread + in-memory dict keyed by `job_id` (UUID4). No persistence. Second upload while one is running → 409 Conflict (MVP).
- **D5** Progress streaming: **SSE** via `sse-starlette`. One event stream per job at `GET /api/jobs/{job_id}/events`.
- **D6** Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui. **Component-reuse principle: shadcn primitives first, wrap-and-extend second, custom from scratch last.**
- **D7** Storage: `server/storage/uploads/{job_id}/{original_name}.mp4`, `server/storage/outputs/{job_id}/out.mp4`. Cleaned up via (a) `DELETE /api/jobs/{id}` and (b) TTL sweep on server boot purging jobs > 2h old. `storage/` gitignored.
- **D8** Auth: none. Bind to `0.0.0.0:8000`; Cloudflare Tunnel adds public HTTPS URL for demo. Tunnel torn down after presentation.
- **D9** Same-origin deployment: FastAPI's `app.mount("/", StaticFiles(...))` serves the built React bundle. No CORS in prod. Dev uses Vite proxy to forward `/api` to `localhost:8000` (still no CORS).
- **D10** Log capture: custom `logging.Handler` attached at the start of `pipeline.run()`, captures all `logger.info/warning/error` records from the pipeline, pushes `LogEvent(level, message, ts)` into an asyncio queue per job. **Zero pipeline code changes for the log panel.**
- **D11** Structured stage progress: **5-line pipeline change** — add `progress_callback: Callable[[str], None] | None = None` kwarg to `VideoPipeline.__init__`, called with `"stage_1_start"`, `"stage_1_done"`, …, `"stage_5_done"` at known transition points. Server adapts these to SSE events. Chose this over log-message parsing (D11-alt) because it's stable and adds finer-grained progress later at near-zero cost.
- **D12** Language dropdown: hardcoded curated list for MVP — `en`, `es`, `zh-cn`, `fr`, `de`, `ja`, `ko`. Exposed from the server via `GET /api/languages` so the frontend doesn't duplicate the list. Adding languages = one config edit.
- **D13** Config per job: server builds a `PipelineConfig` per request by loading `code/config/adv.yaml` (advanced config, CoTracker + PaddleOCR + Hi-SAM) and overriding `input_video`, `output_video`, `translation.source_lang`, `translation.target_lang`. Other knobs stay at config defaults.
- **D14** Cancellation: MVP skips real cancellation. `DELETE /api/jobs/{id}` either (a) removes a queued job before start, or (b) returns 409 "already running, cannot cancel" if the pipeline is mid-run. The user is told the demo will not be cancelable mid-flight. (Proper cancellation would require the pipeline to cooperate with a stop flag — out of scope.)
- **D15** Output video format: the pipeline's `VideoWriter` already produces H.264 MP4 (`mp4v`/`avc1` fourcc) — browser-compatible for `<video>` playback. Verify at integration-test time; if incompatible, ffmpeg-transcode in the runner.
- **D16** SSE reconnection: browser `EventSource` auto-reconnects, but events emitted during the gap are lost. Client reconnects → first fetches `GET /api/jobs/{id}/status` to resync current stage, then re-subscribes to the event stream. MVP accepts log-line loss during reconnects (text panel is best-effort).
- **D17** Nested CLAUDE.md: one in `server/`, one in `web/`. Root `CLAUDE.md` stays unchanged. Server CLAUDE.md covers FastAPI conventions, job model, SSE patterns. Web CLAUDE.md covers React/shadcn conventions and the component-reuse principle (D6).
- **D18** Test shape: `server/tests/` pytest-based, uses FastAPI's `TestClient`. Unit tests for `JobManager` and `PipelineRunner` with a **stubbed pipeline** (no GPU, no AnyText2). Integration test that runs the real pipeline on a tiny test video (skipped by default, marker `gpu`). Frontend: Vitest + React Testing Library for component tests. No frontend E2E tests in MVP.
- **D19** Dependencies: `server/requirements.txt` with `fastapi`, `uvicorn[standard]`, `sse-starlette`, `python-multipart`, `pydantic>=2`; installed into the existing `vc_final` conda env (not a new venv). Frontend deps in `web/package.json`.

### API surface

| Method | Path | Purpose |
|--------|------|---------|
| POST   | `/api/jobs` | multipart: `video` file + `source_lang` + `target_lang` form fields → `{job_id}` |
| GET    | `/api/jobs/{job_id}/status` | `{status, current_stage?, created_at, finished_at?, error?}` |
| GET    | `/api/jobs/{job_id}/events` | SSE stream of events (see below) |
| GET    | `/api/jobs/{job_id}/output` | streams the output MP4, `Content-Disposition: attachment` |
| DELETE | `/api/jobs/{job_id}` | deletes job + files (or 409 if running) |
| GET    | `/api/languages` | `[{code, label}, ...]` — curated list for the dropdown |
| GET    | `/` (and other static paths) | serves the built React bundle |

### SSE event shapes

```ts
type Event =
  | { type: "stage_start",    stage: "s1"|"s2"|"s3"|"s4"|"s5", ts: number }
  | { type: "stage_complete", stage: "s1"|"s2"|"s3"|"s4"|"s5", duration_ms: number, ts: number }
  | { type: "log",            level: "info"|"warning"|"error", message: string, ts: number }
  | { type: "done",           output_url: string, ts: number }
  | { type: "error",          message: string, traceback?: string, ts: number }
```

### Frontend component tree

```
App
├── UploadForm
│   ├── <Dropzone>            (shadcn-compatible file input wrapper)
│   ├── <LanguageSelect />    (wraps shadcn <Select> × 2)
│   └── <Button> Submit       (shadcn)
├── JobView                   (shown after submit)
│   ├── StageProgress         (5 pills, active/done/pending, uses shadcn <Progress>)
│   ├── LogPanel              (monospace <div> with auto-scroll)
│   └── ResultPanel           (shadcn <Button> Download + <video> preview)
└── ErrorAlert                (shadcn <Alert> variant=destructive)
```

**Reuse principle in practice:**
- `<Button>`, `<Select>`, `<Alert>`, `<Progress>`, `<Card>`, `<Label>` → shadcn primitives, no wrapping
- `<LanguageSelect>` → thin wrapper over shadcn `<Select>` (pre-fills options from `/api/languages`)
- `<Dropzone>`, `<StageProgress>`, `<LogPanel>` → custom (no shadcn equivalent), but built from Tailwind classes + shadcn tokens (spacing, colors) to stay visually coherent

## Files to Change

### Pipeline (minimal)
- [ ] `code/src/pipeline.py` — Add optional `progress_callback: Callable[[str], None] | None = None` kwarg to `VideoPipeline.__init__`. Add 10 calls (5 stages × start/done) inside `run()`. No other changes. (D11)

### Server (new)
- [ ] (new) `server/CLAUDE.md` — FastAPI conventions, job model, SSE patterns (D17).
- [ ] (new) `server/requirements.txt` — fastapi, uvicorn[standard], sse-starlette, python-multipart, pydantic>=2 (D19).
- [ ] (new) `server/app/__init__.py`
- [ ] (new) `server/app/main.py` — FastAPI app, router registration, static mount, CORS-less dev via Vite proxy.
- [ ] (new) `server/app/schemas.py` — Pydantic models: `JobCreate`, `JobStatus`, `Language`, event types.
- [ ] (new) `server/app/jobs.py` — `JobManager`: in-memory dict, `ThreadPoolExecutor(max_workers=1)`, single-job concurrency guard (D4), event queues per job.
- [ ] (new) `server/app/pipeline_runner.py` — wraps `VideoPipeline`: attaches `logging.Handler` (D10), builds `PipelineConfig` from `code/config/adv.yaml` + request overrides (D13), wires `progress_callback` to emit SSE events (D11).
- [ ] (new) `server/app/storage.py` — `uploads_dir()`, `outputs_dir()`, `cleanup_job(job_id)`, `sweep_old_jobs(ttl_hours=2)` called on startup (D7).
- [ ] (new) `server/app/languages.py` — curated list (D12).
- [ ] (new) `server/app/routes.py` — the 6 endpoints in the API surface table.
- [ ] (new) `server/tests/test_jobs.py` — `JobManager` unit tests with a stubbed pipeline callable (D18).
- [ ] (new) `server/tests/test_pipeline_runner.py` — log handler + progress callback wiring, mocking `VideoPipeline`.
- [ ] (new) `server/tests/test_api.py` — `TestClient` end-to-end for POST /jobs → SSE events → GET /output, mocking the pipeline.
- [ ] (new) `server/tests/test_storage.py` — cleanup + sweep tests using `tmp_path`.
- [ ] (new) `server/tests/conftest.py` — shared fixtures (test storage dirs, fake pipeline).
- [ ] `.gitignore` — add `server/storage/`.

### Frontend (new)
- [ ] (new) `web/CLAUDE.md` — React/shadcn/Tailwind conventions + **component-reuse principle** (D17, D6).
- [ ] (new) `web/package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `components.json` (shadcn config), `index.html`.
- [ ] (new) `web/src/main.tsx`, `web/src/App.tsx`.
- [ ] (new) `web/src/api/client.ts` — thin fetch wrapper with JSON helpers.
- [ ] (new) `web/src/api/schemas.ts` — hand-authored TS mirror of server Pydantic models (D2).
- [ ] (new) `web/src/api/sse.ts` — EventSource helper + reconnect-with-status-sync logic (D16).
- [ ] (new) `web/src/hooks/useJobStream.ts` — state machine: idle → uploading → running → done/error.
- [ ] (new) `web/src/components/ui/*.tsx` — shadcn-copied components: Button, Select, Alert, Progress, Card, Label, Input.
- [ ] (new) `web/src/components/UploadForm.tsx`, `LanguageSelect.tsx`, `StageProgress.tsx`, `LogPanel.tsx`, `ResultPanel.tsx`, `ErrorAlert.tsx`, `Dropzone.tsx`.
- [ ] (new) `web/src/lib/utils.ts` — shadcn's `cn()` helper.
- [ ] (new) `web/src/styles/globals.css` — Tailwind directives + shadcn CSS variables.
- [ ] (new) `web/.eslintrc.cjs` or flat config, `web/.gitignore` (node_modules, dist).
- [ ] (new) `web/vitest.config.ts` and 3–4 component tests.

### Build / deploy
- [ ] (new) `server/scripts/build_frontend.sh` — `cd web && npm ci && npm run build && rm -rf ../server/app/static && cp -r dist ../server/app/static`.
- [ ] (new) `server/scripts/dev.sh` — runs `uvicorn --reload` on 8000 and `npm run dev` on 5173 with Vite proxy.
- [ ] `docs/architecture.md` — new top-level section "Web Application" pointing at `server/` and `web/` with the architecture diagram.

## Risks

- **R1 — MVP cancellation is effectively no-op.** If the user submits a video and wants to stop mid-pipeline, they can't. Demo-day workaround: don't let anyone submit a second video. Acceptable for MVP (D14). Longer-term fix would require cooperative cancellation points inside the pipeline.
- **R2 — Large-file uploads.** Starlette's `UploadFile` spools to disk when big, so memory is fine, but uploads of >100MB videos take significant time over a Cloudflare Tunnel. Mitigation: cap upload size at ~200MB server-side; show a client-side size warning.
- **R3 — Output format browser compatibility.** If OpenCV's `VideoWriter` outputs a fourcc the browser can't decode, `<video>` won't play. Mitigation: verify at integration test time on a short clip; if needed, ffmpeg-transcode in the runner (adds a `ffmpeg -c:v libx264 -crf 23 ...` step post-pipeline). Flagged as a Step 7 risk.
- **R4 — Logs contain traceback with absolute paths.** Leaking server paths in the log panel is cosmetic, not security-critical for a demo, but noticeable. Mitigation: `LogEvent` formatter strips known prefixes (optional; skip if low-priority).
- **R5 — `python-multipart` version pin.** FastAPI's multipart parsing has had version drift with starlette/pydantic v2. Mitigation: pin versions in `requirements.txt` and smoke-test one upload before writing more.
- **R6 — Pipeline uses `sys.path.insert` to find `src`.** The runner needs to do the same (or install `code/src` as a package — too invasive for MVP). Mitigation: `pipeline_runner.py` prepends `code/` to `sys.path` at import time, mirroring `scripts/run_pipeline.py`.
- **R7 — Frontend/server schema drift.** Hand-maintained TS types (D2) will eventually diverge from Pydantic models. Mitigation: dedicated `schemas.ts` file with comments pointing at the Pydantic source; small enough surface (1 request type + 5 event types + 2 status shapes) that drift is catchable at code-review time. Generate from OpenAPI if the surface grows.
- **R8 — Single-worker = demo becomes a queue of one.** If the demo-day presenter triggers a run, then accidentally reloads the browser during processing, a fresh submit returns 409. Mitigation: surface "one active job: [view]" instead of a hard error, with a link to rejoin the SSE stream for the running job.
- **R9 — Cloudflare Tunnel + SSE.** Some proxies buffer or close long-running SSE streams. Cloudflare Tunnel historically supports SSE but has timeouts. Mitigation: confirm with a dry run before the real demo; if SSE drops, fallback polling on `/status` still keeps the progress bar alive (degrades gracefully).
- **R10 — Server CLAUDE.md scope vs root CLAUDE.md scope.** Nested CLAUDE.md loads on-demand; root is always active. Mitigation: keep root focused on pipeline + team conventions (unchanged), keep server/web CLAUDE.md focused on their own stack choices (no duplication).

## Done When

- [ ] End-to-end demo flow works on a dev machine: upload `real_video6.mp4`, pick en→zh, see 5 stages turn green sequentially, log panel scrolls with pipeline logs, download button enables, downloaded MP4 plays in browser.
- [ ] 409 returned when a second job is submitted while one is running; client shows a "rejoin existing run" link instead of an error.
- [ ] Log panel reaches the end and shows a final "Pipeline complete" message tied to the `done` event.
- [ ] `server/tests/` green with a mocked pipeline; one integration test (marked `gpu`) runs the real pipeline on a tiny fixture video.
- [ ] `web/` `vitest` green on component tests.
- [ ] `ruff check server/` clean; `eslint web/` clean; `tsc --noEmit` clean.
- [ ] Frontend is served from FastAPI at `http://localhost:8000/` after `build_frontend.sh`.
- [ ] Cloudflare Tunnel dry run: submit from a different network, full flow works, SSE survives ~90s pipeline run without dropping.
- [ ] `docs/architecture.md` Web Application section added.
- [ ] `server/CLAUDE.md` + `web/CLAUDE.md` written.
- [ ] Code review by `@reviewer` — feedback addressed.
- [ ] Changes committed as atomic commits + PR opened.

## Progress

- [ ] **Step 1** — Pipeline `progress_callback` hook. Add the optional kwarg + 10 transition calls to `VideoPipeline`. Unit test the hook fires at the right boundaries (mock a single stage). (D11)
- [ ] **Step 2** — `server/` scaffold: requirements, folder layout, empty FastAPI app, pytest baseline (1 trivial test). `ruff check` clean.
- [ ] **Step 3** — `storage.py` + tests: upload/output paths, cleanup, TTL sweep with `tmp_path`. (D7)
- [ ] **Step 4** — `schemas.py` + `languages.py`: Pydantic request/response models, SSE event types, curated language list. (D12)
- [ ] **Step 5** — `JobManager` + tests with a stubbed runner: UUID allocation, single-worker execution, event queue per job, 409 on concurrent submit, state transitions. (D4)
- [ ] **Step 6** — `PipelineRunner` + tests: logging.Handler wiring, progress_callback adapter, error capture. Stub `VideoPipeline` to verify the handler sees log records. (D10, D11)
- [ ] **Step 7** — `routes.py` + `test_api.py`: all 6 endpoints via `TestClient`, mocked pipeline. SSE assertions via `httpx` streaming. (API surface)
- [ ] **Step 8** — Server integration smoke: real pipeline on a tiny video (2 seconds), `gpu`-marked. Check output MP4 plays in `<video>`; if not, add ffmpeg transcode step. (R3)
- [ ] **Step 9** — `server/CLAUDE.md` written. (D17)
- [ ] **Step 10** — `web/` scaffold: Vite + React + TS + Tailwind + shadcn init. `npm run build` + `npm run dev` both work. Vite proxy to `localhost:8000`.
- [ ] **Step 11** — `api/`: client, schemas, SSE helper with reconnect. Unit-test the SSE parser against fixture streams. (D16, R7)
- [ ] **Step 12** — `UploadForm` + `LanguageSelect` + `Dropzone`. Uses shadcn primitives directly where possible (D6).
- [ ] **Step 13** — `JobView` + `StageProgress` + `LogPanel` + `ResultPanel`. `useJobStream` hook. 3–4 component tests.
- [ ] **Step 14** — `web/CLAUDE.md` written — bakes in the reuse principle. (D6, D17)
- [ ] **Step 15** — Build pipeline: `build_frontend.sh` + `dev.sh`. FastAPI serves `/` from `server/app/static/`. End-to-end dev flow works.
- [ ] **Step 16** — Full demo dry run on the dev box: real pipeline, real AnyText2, real upload/download.
- [ ] **Step 17** — Cloudflare Tunnel dry run + SSE survival check from a different network. (R9)
- [ ] **Step 18** — Update `docs/architecture.md`.
- [ ] **Step 19** — `@reviewer` pass, address feedback.
- [ ] **Step 20** — Atomic commits + PR.
