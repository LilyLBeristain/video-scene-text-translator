# Session: Web Client — 2026-04-18

## Completed
- Bootstrapped the GPU box: miniforge3 (existing) → conda env `vc_final` (Python 3.11) → torch `2.5.1+cu124` (only line that keeps Volta in cu wheels) → paddlepaddle 3.3 (cu126) → easyocr → cotracker3 → paddleocr → Hi-SAM. CUDA + matmul verified on the V100 (driver 12.8).
- Implemented plan steps 1-15, 18: pipeline `progress_callback` hook, full FastAPI server (storage, schemas, languages, JobManager, PipelineRunner with ffmpeg transcode, 6 routes, lifespan + SPA static mount, dev/build scripts), full React SPA (Vite + TS + Tailwind + shadcn, API client + SSE helper + useJobStream, UploadForm/JobView/etc.), nested CLAUDE.md for server + web, architecture.md "Web Application" section.
- Dry-run by user via SSH port-forward; surfaced + fixed two translator bugs (zh-cn → zh-CN, MyMemory locale map).
- Three per-part code reviews (web/server/pipeline) → 10 must+should fixes landed atomically.
- Nice-to-have triage → 6 fixes (LogPanel scroll escape, dev.sh env check, atomic build swap, type-mapping doc, multicast HTTP test, _MYMEMORY_LOCALE → module scope).
- Full-change cross-cutting review → 6 more fixes (SSE-reconnect outputUrl bug, hardcoded URL, queued→connecting, terminal-resync stream close, miniforge3 path doc, +3 hook tests).
- 41 commits on `feat/web-client`, all atomic, conventional format.

## Current State
- All test suites green: pipeline 433, server 87 default + 3 gpu, web 60. Ruff + ESLint clean.
- Real end-to-end demo flow works: upload → 5-stage SSE progress → log panel → playable MP4 download. Verified on V100 + live AnyText2 at `109.231.106.68:45843` and via the user's browser.
- Branch is **38 ahead of `origin/feat/web-client`**; nothing pushed yet.
- `server/storage/` contains user dry-run artifacts (gitignored).

## Next Steps
1. Push `feat/web-client` to origin.
2. Open the PR (Step 20).
3. Optional cleanup: `rm -rf server/storage/` before review handoff.
4. Defer post-MVP: round-trip Pydantic ↔ TS contract test (review #6); wrap DELETE response in a Pydantic model (review #8); test helpers → conftest.py "if suite grows" (P2); Cloudflare Tunnel (Step 17).

## Decisions Made
- **Wheel pins for V100 + driver 12.8:** torch `2.5.1+cu124` (last version with Volta binary wheels), paddle `3.3.0` on cu126. cu130 wheels install but `cuda.is_available() = False`; cu128 wheels work but drop Volta.
- **`adv.yaml` checkpoint paths resolved against `code/` in `_build_config`** instead of editing the YAML or `cd`'ing — server runs uvicorn from repo root, CLI ran from `code/`. Plus auto-disable `revert.use_refiner` when `refiner_v1.pt` is missing.
- **OpenCV `mp4v` fourcc isn't browser-playable** — added unconditional `ffmpeg libx264` transcode at the end of `run_pipeline_job` (R3 confirmed real, not theoretical).
- **D16 terminal-state-flip invariant:** the `emit` closure mutates `record.status` *before* enqueueing Done/Error, so subscribers can't observe stale "running" via `/status` polling.
- **SSE multicast fan-out:** per-subscriber `asyncio.Queue` list (was a single queue → split events between concurrent subscribers). Late subscribers see no replay; clients re-sync via `/status`.
- **`outputUrl` populated in BOTH SSE done event and `applyStatusSync`:** the second site is the only path the client learns the job finished if `done` lands in an SSE reconnect gap. Without this the download button disappears.
- **Cloudflare Tunnel deferred** — not a functionality gap; same-network access + ngrok cover the demo.
- **Frontend test environment globally jsdom** (not per-file override) — Radix needs `hasPointerCapture`/`scrollIntoView` stubs in `beforeAll` for tests that open Selects.

## Open Questions
- Root `CLAUDE.md` references `/opt/miniconda3` — this GPU box has `/opt/miniforge3`. Server CLAUDE.md now lists both; root may need a similar tweak depending on Hebin's machine.
- `gradio_client` and `einops` are pipeline runtime deps but not in `code/requirements/gpu.txt`. Installed ad-hoc here. Worth pinning.
- Push convention: who opens the PR — me running `gh pr create`, or you?
