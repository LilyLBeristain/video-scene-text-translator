# Plan: Reorganize Test Directory + Add Real E2E Test

## Goal
Restructure the flat 14-file test directory into a tiered layout (unit / stages / models / integration / e2e) so tests are organized by scope and speed. Add a real e2e test that exercises the full pipeline (PaddleOCR + CoTracker + AnyText2 server) on a GPU machine. Default `pytest` on a local machine must skip e2e automatically.

## Approach

### Directory structure
```
tests/
├── __init__.py
├── conftest.py                      # Shared fixtures + marker registration (kept as-is)
├── unit/                            # Fast, pure logic, no external deps (~67 tests)
│   ├── __init__.py
│   ├── test_config.py
│   ├── test_data_types.py
│   ├── test_geometry.py
│   ├── test_image_processing.py
│   ├── test_optical_flow.py
│   └── test_video_io.py
├── stages/                          # Stage tests, mock external deps (~66 tests)
│   ├── __init__.py
│   ├── test_s1_detection.py
│   ├── test_s2_frontalization.py
│   ├── test_s3_text_editing.py
│   ├── test_s4_propagation.py
│   ├── test_s5_revert.py
│   └── test_streaming_detection.py
├── models/                          # Model backend tests, mock server (~29 tests)
│   ├── __init__.py
│   └── test_anytext2_editor.py
├── integration/                     # Wiring tests, mocked externals (~2 tests)
│   ├── __init__.py
│   └── test_pipeline.py             # renamed from test_pipeline_integration.py
└── e2e/                             # Real resources: GPU + AnyText2 server + network
    ├── __init__.py
    ├── conftest.py                  # Auto-skip fixtures (no GPU, no server, no test video)
    └── test_real_pipeline.py        # Full pipeline, zero mocks
```

### E2E exclusion (two layers)
1. **`pytest.ini` with `addopts = --ignore=tests/e2e`** — e2e never runs unless explicitly requested
2. **Auto-skip fixtures in `tests/e2e/conftest.py`** — safety net: checks GPU, AnyText2 server reachability, test video existence. If any missing, test is `skipped` (not failed).

Local: `pytest tests/ -v` runs unit + stages + models + integration, ignores e2e.
GPU machine: `pytest tests/e2e/ -v` explicitly opts in.

### E2E test assertions
- Output video exists with correct frame count and resolution matching input
- At least 1 text track detected and translated
- AnyText2 produced a non-degenerate edited ROI (not all-black/uniform)
- Pipeline completes without exceptions
- Per-stage timing logged for performance monitoring

### Marker registration
Root `conftest.py` registers custom markers: `slow`, `gpu`, `network`. Not heavily used initially but enables selective filtering as test suite grows.

### What stays the same
- All `from src.*` imports unchanged — no test file needs import edits
- Root `conftest.py` fixtures unchanged (synthetic frames, quads, tracks, config)
- Test file contents unchanged — only locations move
- `__pycache__` directories regenerate automatically

## Files to Change
- [ ] `code/pytest.ini` — (new) add `addopts = --ignore=tests/e2e` and marker registration
- [ ] `code/tests/conftest.py` — Add `pytest.mark` registration for `slow`, `gpu`, `network`
- [ ] `code/tests/unit/__init__.py` — (new) empty
- [ ] `code/tests/stages/__init__.py` — (new) empty
- [ ] `code/tests/models/__init__.py` — (new) empty
- [ ] `code/tests/integration/__init__.py` — (new) empty
- [ ] `code/tests/e2e/__init__.py` — (new) empty
- [ ] `code/tests/e2e/conftest.py` — (new) auto-skip fixtures for GPU, AnyText2 server, test video
- [ ] `code/tests/e2e/test_real_pipeline.py` — (new) real e2e test
- [ ] Move 6 files → `tests/unit/`
- [ ] Move 6 files → `tests/stages/`
- [ ] Move 1 file → `tests/models/`
- [ ] Move 1 file → `tests/integration/` (rename test_pipeline_integration.py → test_pipeline.py)
- [ ] Remove old files from `tests/` root after moves
- [ ] `CLAUDE.md` — Update test commands to reflect new structure

## Risks
- **Fixture discovery**: pytest resolves `conftest.py` by walking up from the test file. Root `tests/conftest.py` is still an ancestor of all subdirs, so shared fixtures work. Verified: no subdir-specific conftest needed except `e2e/`.
- **CI breakage**: If CI runs `pytest tests/`, the `pytest.ini --ignore=tests/e2e` ensures e2e is excluded. No CI changes needed.
- **Duplicate fixtures in `test_streaming_detection.py`**: This file re-declares `default_config`, `rect_quad`, `synthetic_frame`, `synthetic_frame_shifted` fixtures that overlap with root `conftest.py`. The local fixtures take precedence (pytest scoping), so no breakage — but worth cleaning up later.
- **Git history**: `git mv` preserves history. One commit for the moves, separate commit for new files.

## Done When
- [ ] All 14 existing test files moved to correct subdirectories
- [ ] `pytest tests/ -v` from `code/` runs 171 tests, 0 e2e (same as before)
- [ ] `pytest tests/e2e/ -v` runs real e2e on GPU machine (or skips gracefully without GPU/server)
- [ ] `pytest tests/unit/ -v` runs only unit tests (~67)
- [ ] `pytest tests/stages/ -v` runs only stage tests (~66)
- [ ] No import changes in any moved test file
- [ ] CLAUDE.md test command updated

## Progress
- [x] Step 1: Create `pytest.ini` and register markers in root `conftest.py`
- [x] Step 2: Create subdirectory structure (`unit/`, `stages/`, `models/`, `integration/`, `e2e/`) with `__init__.py` files
- [x] Step 3: `git mv` existing test files to their new locations
- [x] Step 4: Write `tests/e2e/conftest.py` with auto-skip fixtures
- [x] Step 5: Write `tests/e2e/test_real_pipeline.py`
- [x] Step 6: Verify all tests pass — 171 passed (1.32s) + 4 e2e passed (224.80s)
- [x] Step 7: Update CLAUDE.md test commands
