# Session: Web Client UI Redesign — 2026-04-18 (continuation)

## Completed
- Delivered all 19 plan steps (Steps 1–15 implementation + 16 smoke + 17 docs + 18 reviewer + 19 commits). Plan archived to `docs/plans_archive/web-client-ui-redesign.md`.
- Two full `@reviewer` rounds. Round 1 (post-Step-14): 0 must / 4 should, all fixed. Round 2 (post-polish-series): 2 must / 4 should / 3 nice-to-have, must + should all fixed.
- Heavy mockup-alignment polish series driven by live browser iteration: `StatusBand` chrome chips (jobId / progress / pill + middle dots) with phase-specific eyebrow labels, `StageProgress` elapsed readout (`elapsed MM:SS` / `total MM:SS` / `crashed at Stage N of 5`), `FailureCard` red-tinted card + details-open, `RejoinCard` full-width with full jobId, `UploadProgress` two-column layout matching mockup 02, `IdlePlaceholder` exact-mockup SVG, `ResultPanel` green full-width download.
- Adaptive `<AppShell>`: fluid `min 960×620 / max 1440×880` replacing the original fixed 1080×760. Outer `h-screen overflow-hidden` so the page never scrolls — panels scroll internally. `ResultPanel` video now `flex-1 min-h-0 object-contain` so it shrinks to fit short viewports (13" Mac) without overflow.
- Server-side: `FileResponse.filename` → `translated.mp4` so saved file matches the button label. Added a commented-out `DEMO_FAIL_STAGE` hook in `pipeline_runner.py` for UI failure-view smoke, then reverted.
- `README.md` reorganized: Env Setup right after the blurb, then Usage → Web App → Architecture (consolidated pipeline overview + data types + stage I/O) → Project Structure. Steps 2–4 collapsed into a single `requirements/gpu.txt` / `cpu.txt` path; stale `UploadForm.tsx` / `JobView.tsx` references dropped; web test count refreshed 60 → 147.
- S3 diagnostics (post-hang report from operator): per-region INFO logs + try/except around `editor.edit_text` + AnyText2 submit/result timing, to surface silent-hang location next time.

## Current State
- Branch `feat/web-client`, 48 commits ahead of `origin/feat/web-client`. Tree clean.
- Web tests 147/147, server tests 87/87 (plus 3 GPU-marked deselected by default), pipeline tests 430/430 (non-e2e).
- Both services running: uvicorn :8000 (prod SPA + API), Vite :5173 (HMR dev).
- All shipped UI surfaces validated live in-browser through iterative polish. Demo failure hook commented out in `pipeline_runner.py`.

## Next Steps
1. Merge `feat/web-client` to master when ready (48 commits; rebase-clean).
2. Real GPU end-to-end run once GPU time is available — only remaining Step 16 bullet not closed; no code blockers expected.
3. If S3 silent-hang recurs, read the new INFO logs to locate the exact block (submit vs result); if the 120s `server_timeout` isn't firing reliably, wrap `job.result` in a `ThreadPoolExecutor(1) + future.result(timeout=...)` external timeout.
4. Open defer list (noted in archived plan + CLAUDE.md): ETA heuristic, post-terminal log toggle, region-count stat on Succeeded, Retry button on Failed, session marker, ⟳ replace chip.

## Decisions Made
- **Adaptive shell over fixed 1080×760.** Operator wanted responsive layout during smoke; mockup's pixel dimensions are a reference, not a contract. `max 1440×880 / min 960×620` with `<DesktopRequired>` fallback.
- **LogPanel hidden in terminal states** (succeeded + failed) by design. Mockup 04/05 don't show it; terminal surfaces carry the affordance. Documented at the gate site + in CLAUDE.md + archived plan's defer list.
- **VideoCard blob URL revoke deferred through `queueMicrotask`** — StrictMode dev's synchronous `mount → cleanup → mount` would otherwise yank the URL while the `<video>` still held it. Flagged as a dev-only flicker risk, not a prod issue; prod doesn't double-invoke.
- **No hard timeouts in S3 for now.** Legitimate edits can legit take 8–15 min on many-region clips. Diagnostics first; tighten only if data shows the per-region 120s isn't honored.
- **Gray `LOCKED` pill on active-phase INPUT** (not warn yellow) — operator override of the mockup after seeing both.
- **Download filename is server-authoritative** (`Content-Disposition: attachment; filename="translated.mp4"`); the `<a download>` attribute is belt-and-suspenders. Otherwise browsers prioritize server over anchor.

## Open Questions
- Real GPU end-to-end smoke not yet done; everything short of it has been verified. No known blockers but worth confirming nothing drifted in the long polish series.
- If the S3 silent-hang reproduces with the new logging, we'll know whether to add an external `ThreadPoolExecutor` timeout around the gradio_client call or leave the 120s config as-is.
