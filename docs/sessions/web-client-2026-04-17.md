# Session: Web Client MVP Planning — 2026-04-17

## Completed
- Committed the final presentation artifacts + session docs on `pres/final-slides` (4 atomic commits; gitignored `node_modules/`, generated slide JPGs, `.DS_Store`)
- Checked out `master`, fast-forwarded 28 commits (picked up the `feat/text_seg` merge: Hi-SAM segmentation inpainter backend for S4, S3 adaptive-mask wiring fix, S5 pre-composite dispatch)
- Archived the completed Hi-SAM `plan.md` to `docs/plans_archive/hisam-inpainter.md`
- Created `feat/web-client` branch
- Researched monorepo vs multi-repo tradeoffs for Claude-Code-assisted dev (web searches + sources in-session); landed on **keep this repo as a monorepo, use nested CLAUDE.md for server/web**
- Wrote `plan.md` for the web-client MVP — 19 decisions (D1–D19), 10 risks (R1–R10), 20 progress steps — and committed it

## Current State
- **Branch:** `feat/web-client` (ahead of master by 2 commits: archive + plan commit)
- **No code yet.** Only docs touched: `plan.md` added, old plan archived.
- **Working tree clean.** All cache/DS_Store/node_modules cleaned up earlier in the session.
- Root `CLAUDE.md` unchanged. Nested `server/CLAUDE.md` + `web/CLAUDE.md` will be written in Steps 9 and 14.

## Next Steps (resume here)
1. `git fetch && git checkout feat/web-client && git pull` on the remote GPU box
2. Start Claude Code from the repo root; run `/load-context` to pick up plan.md
3. **Begin Step 1** from plan.md: add `progress_callback: Callable[[str], None] | None = None` kwarg to `VideoPipeline.__init__` in `code/src/pipeline.py`, emit `"stage_{N}_start"` + `"stage_{N}_done"` at the 5 stage transitions, add a small unit test
4. Then Step 2 (server scaffold) through Step 20 (commits + PR). Steps 1–7 and 9–15 don't need GPU; Steps 8, 16, 17 do — which is why remote.

## Decisions Made
- **Monorepo over multi-repo.** Nested CLAUDE.md (root + `server/` + `web/`) is *easier* to maintain than duplicated root context across repos — opposite of the initial worry. Sources: [Medium virtual-monorepo post](https://medium.com/devops-ai/the-virtual-monorepo-pattern-how-i-gave-claude-code-full-system-context-across-35-repos-43b310c97db8), [Claude Code memory docs](https://code.claude.com/docs/en/memory).
- **Execute on remote GPU box, not local Mac.** With Claude Code installed on the remote, there's no SSH handoff overhead. Staying in one env eliminates the Mac-stub vs real-pipeline drift and lets the same session complete Steps 8/16/17 (GPU-required) without pausing for handoffs.
- **Strict MVP scope:** upload → pick langs → 5-stage progress bar + live text log panel → download. Out: stage-preview images, history, auth, persistence, sample videos.
- **Job model:** single worker thread + in-memory dict. Second upload while one is running → 409 with "rejoin existing run" link on the client. No Redis, no SQLite. Justified by the live-demo context (one run at a time, presenter-driven).
- **In-process pipeline call, not subprocess.** Required for clean log-handler capture + structured progress events.
- **Log panel = zero pipeline changes** via a `logging.Handler` attached at `run()` start. Structured 5-step progress bar = 5-line pipeline change (new `progress_callback` kwarg). Chose the hook over parsing log strings for stability.
- **FastAPI + sse-starlette + React/Vite + TypeScript + Tailwind + shadcn/ui.** FastAPI serves the built React bundle from the same origin → no CORS. Dev uses Vite proxy to `localhost:8000`.
- **Frontend component-reuse discipline:** shadcn primitives first, wrap-and-extend second, custom from scratch last. Baked into D6 and will be repeated in `web/CLAUDE.md` (Step 14).
- **Server uses `code/config/adv.yaml` as the base config** (CoTracker + PaddleOCR + Hi-SAM). Overrides per request: `input_video`, `output_video`, `translation.source_lang`, `translation.target_lang`. Nothing else exposed to the UI.
- **Language dropdown:** `en, es, zh-cn, fr, de, ja, ko` — curated server-side at `/api/languages`, one source of truth.
- **Auth: none.** Cloudflare Tunnel for demo access; tear down after the presentation.
- **Cancellation: not real in MVP.** `DELETE /api/jobs/{id}` only works for jobs not yet running. Acknowledged in D14 + R1.

## Open Questions
- **Step 17 (tunnel dry run)** — confirm SSE survives 90s+ through Cloudflare Tunnel on the target network before demo day. If Cloudflare buffers SSE, ngrok is a drop-in fallback.
- **AnyText2 server reachability** from the GPU box — verify `text_editor.server_url` in `adv.yaml` points at a live AnyText2 before Step 8 integration test. Currently set in `adv.yaml` (check with `grep server_url code/config/adv.yaml`).
- **Output MP4 codec compatibility** with browser `<video>` (R3). OpenCV `VideoWriter` default may not be H.264. Verify at Step 8; if broken, add a one-line ffmpeg transcode in `pipeline_runner.py`.
- **Node install on the remote** — `node -v` before Step 10. Node 20+ required for Vite 5 / shadcn tooling.

## Quick-Start Commands for the Remote Session
```bash
# Pull the branch + plan
git fetch && git checkout feat/web-client && git pull

# Verify the env
conda activate vc_final
node -v   # need 20+
cat plan.md | head -60

# Start Claude Code from the repo root, then:
#   /load-context        # picks up this summary + plan.md
#   "start step 1"       # kick off implementation
```
