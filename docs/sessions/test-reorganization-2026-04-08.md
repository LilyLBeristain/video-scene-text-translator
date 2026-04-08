# Session: Test Reorganization & Real E2E — 2026-04-08

## Completed
- Ran real e2e pipeline on GPU (V100): PaddleOCR + CoTracker + AnyText2 server on `real_video6.mp4` — "WARDEN" → "GUARDIÁN", 178 frames, ~66s
- Reorganized flat 14-file `tests/` into tiered layout: `unit/` (6), `stages/` (6), `models/` (1), `integration/` (1)
- Added `pytest.ini` with `--ignore=tests/e2e` default + `slow`/`gpu`/`network` markers
- Created `tests/e2e/conftest.py` with auto-skip fixtures (GPU, AnyText2 server, test video)
- Created `tests/e2e/test_real_pipeline.py` with 4 real e2e tests (zero mocks)
- Updated CHANGELOG.md and CLAUDE.md

## Current State
- Branch `feat/anytext2-integration` — all plan steps complete, 2 new commits
- `pytest tests/ -v` → 171 passed (1.3s), e2e auto-ignored
- `pytest tests/e2e/ -v` → 4 passed (225s on V100), auto-skips on local machines
- AnyText2 ROI quality fix confirmed working on real video (640x256, 64-aligned, no black corners)

## Next Steps
1. Merge `feat/anytext2-integration` to master
2. Investigate CoTracker OOM on 1080p+ video
3. Consider Option C (expand ROI with real scene context from S2) if quality still needs improvement
4. Add more test videos for e2e coverage (different text counts, languages, resolutions)

## Decisions Made
- **Tiered test layout over flat**: 171 tests across 14 files warranted organization before further growth. Subdirs by scope (unit/stages/models/integration/e2e).
- **Two-layer e2e exclusion**: `pytest.ini --ignore` + auto-skip fixtures. Belt and suspenders — local devs never accidentally run 4-minute GPU tests.
- **`test_streaming_detection.py` stays in `stages/`**: It tests an S1 submodule (`StreamingTextTracker`), even though its primary consumer is the TPM data gen pipeline. A `pipelines/` dir can be added when TPM pipeline tests arrive.
- **E2E as pytest, not shell script**: Same runner, same fixtures, same assertions as the rest of the suite. More maintainable than a standalone script.

## Open Questions
- Does AnyText2 quality hold across different ROI sizes and aspect ratios? Only tested on one video.
- For extreme aspect ratios (e.g., 1000x30), padding dominates — may need Option C for these cases.
