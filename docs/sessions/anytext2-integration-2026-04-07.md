# Session: AnyText2 Integration E2E Testing — 2026-04-07

## Completed
- Set up full dev environment on Vast.ai remote GPU (RTX 4070 Ti SUPER, 16GB) using `uv venv` — no conda needed
- Installed all deps: PyTorch (CUDA 13.0), PaddlePaddle GPU, PaddleOCR, EasyOCR, CoTracker3, gradio_client
- Fixed 4 bugs in AnyText2Editor discovered during live server testing: RGBA mask format, quoted text_prompt, submit/result API, gallery result parsing
- Fixed CoTracker checkpoint relative paths (`../third_party/...` for scripts running from `code/`)
- Added connection timeout to Gradio Client, sent m1 mimic image for font extraction, fixed "supper" typo
- Addressed all code review findings (7 items across 2 commits)
- Ran full pipeline end-to-end on synthetic video (150 frames) — all 5 stages completed successfully
- Ran pipeline on real video (`real_video6.mp4`, 1080x1920) — OOM on CoTracker, succeeded with Farneback fallback at half resolution
- Updated CHANGELOG with e2e integration fixes
- Pushed 6 commits to `feat/anytext2-integration`

## Current State
- Branch `feat/anytext2-integration` pushed to origin (13 commits ahead of master)
- All 9 plan steps complete; 160 tests passing, lint clean
- AnyText2 end-to-end integration verified on both synthetic and real video
- Real video test: 1 track ("WARDEN") detected, edited, propagated across 178 frames

## Next Steps
1. Merge `feat/anytext2-integration` to master
2. Investigate CoTracker OOM on 1080p+ video — consider chunked inference or using streaming pipeline
3. Fix googletrans instability (`'NoneType' object is not iterable` on some words like "WARDEN")
4. Test with more real videos at full resolution on a larger GPU (24GB+)
5. Stage C planning (TPM model integration) if time permits

## Decisions Made
- **`uv` over conda on remote**: Machine had no conda, `uv` was pre-installed. All deps are pip-installable, no conda-specific packages needed.
- **Farneback fallback for real video**: CoTracker OOM on 16GB GPU with 1080p video. Farneback is CPU-based, no VRAM issue. Quality tradeoff is acceptable for testing.
- **CoTracker paths `../third_party/`**: Scripts run from `code/` dir, so relative paths need `../` prefix. Updated both `adv.yaml` and `config.py` default to match.
- **gradio_client v2.4 API**: Uses `submit()` + `job.result(timeout=...)` instead of `predict(result_timeout=...)`. Different from what was mocked in tests — tests updated.

## Open Questions
- googletrans failing silently on some words — need a more robust translation backend?
- CoTracker memory usage: 16GB insufficient for 1080p@60-frame windows. Is streaming pipeline the right solution, or should we add frame downscaling to the main pipeline?
- AnyText2 edit quality on small ROIs — hard to evaluate at half resolution
