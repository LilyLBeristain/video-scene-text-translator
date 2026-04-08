# Cross-Language Scene Text Replacement in Video
CMPT 743 Visual Computing Lab II final project (SFU). Replace scene text in video frames across languages, preserving font style, perspective, and lighting consistency. Team: Hebin Yao, Yunshan Feng, Liliana Lopez.

## Workflow

### Session
1. At session start, run /load-context to load context from the previous session.
   Older session history is in docs/sessions/ — read when you need context beyond the last session.
2. At session end when I ask, run /session-summary to archive the session.

### Development
When starting a new feature:
1. Create a feature branch: feat/, fix/, chore/
2. Run /architect if the project has no docs/architecture.md yet.
3. Run /plan to brainstorm and write plan.md for this feature. Wait for approval.
   If plan.md already exists for this feature, load it and continue from where it left off.
4. If a design decision needs research, delegate to @researcher.

When implementing:
5. For scoped module work, delegate to @coder with the specific plan step.
6. If @coder reports unresolved test failures, delegate to @debugger with the error output.
7. After completing each plan step, mark it as [x] in plan.md Progress and note any changes.

When wrapping up:
8. Delegate to @reviewer for code review.
9. Commit changes — the commit skill will propose atomic splits for approval.
10. When merging a feature branch to main, check if docs/architecture.md needs updating to reflect what was actually built.

## Commands
dev:    python scripts/run_pipeline.py --input <video> --output <out> --source-lang en --target-lang es
tpm:    python scripts/run_tpm_data_gen_pipeline.py --config config/adv.yaml --input <video> --output-dir <out>
test:   cd code && python -m pytest tests/ -v
e2e:    cd code && python -m pytest tests/e2e/ -v   # GPU + AnyText2 server required
lint:   ruff check code/
build:  (N/A — not a distributable package)

## Stack
- Python 3.11 (conda env: `vc_final`)
- OpenCV (cv2) — core CV operations, homography, optical flow
- NumPy — array operations
- PyYAML — config loading
- Pillow — image I/O, accented character rendering
- EasyOCR / PaddleOCR — scene text detection (configurable via `detection.ocr_backend`)
- CoTracker3 — learned point tracking for optical flow (`third_party/co-tracker/`)
- wordfreq — gibberish OCR detection filtering
- tqdm — progress bars for long-running stages
- googletrans 4.0.0-rc1 — translation API (not yet installed)
- pytest + pytest-cov — testing (171 unit/integration + 4 e2e tests)
- ruff — linting and formatting

## Key Directories
- `code/src/` — Pipeline implementation (5 stages)
- `code/src/stages/` — S1 detection, S2 frontalization, S3 text editing, S4 propagation, S5 revert
- `code/src/stages/s1_detection/` — Submodules: detector, tracker, selector, stage + streaming variants
- `code/src/models/` — Stage A model interface (BaseTextEditor ABC) + backends
- `code/src/utils/` — Geometry, image processing, optical flow, CoTracker online wrapper
- `code/config/` — default.yaml (classical CV defaults), adv.yaml (CoTracker + PaddleOCR)
- `code/tests/` — Tiered test suite: `unit/`, `stages/`, `models/`, `integration/`, `e2e/`
- `code/scripts/` — CLI entry points (run_pipeline.py, run_tpm_data_gen_pipeline.py)
- `third_party/` — Install scripts for CoTracker, PaddleOCR
- `_refs/` — Pipeline diagram, milestone report
- `docs/` — Architecture docs, session summaries

## Conventions
- All configurable values live in `config/default.yaml` or `config/adv.yaml`, never hardcoded
- Stages communicate via `TextTrack` dataclass — the central data structure flowing through S1→S5
- Stage A models implement `BaseTextEditor` ABC — swap backends via `text_editor.backend` in config
- Lazy initialization for expensive resources (EasyOCR, PaddleOCR, translator) — never import at module level
- Detections keyed by `frame_idx` (dict, not list) for O(1) lookup
- Two pipelines: main (`pipeline.py`, in-memory) and TPM data gen (`tpm_data_gen_pipeline.py`, streaming 2-pass)
- Activate conda before any command: `eval "$(/opt/miniconda3/bin/conda shell.bash hook)" && conda activate vc_final`
- Domain-specific rules auto-load from .claude/rules/ when working in matching paths

## Gotchas
- Never import easyocr, paddleocr, or googletrans at module level — they're lazy-loaded and may not be installed
- Always activate conda env before running tests or pipeline
- Main pipeline loads all frames into memory — will break on long videos (>500 frames). TPM data gen pipeline uses streaming 2-pass to avoid this.
- googletrans is unofficial and may fail silently — always verify translation output
- config weight arrays must sum to ~1.0 (detection: 4 weights, reference: 2 weights) — validation catches this
- CoTracker requires GPU and checkpoint files in `third_party/co-tracker/checkpoints/` — run `third_party/install_cotracker.sh` first
- PaddleOCR tests fail if paddleocr is not installed — run `third_party/install_paddleocr.sh` first
- Two config files: `default.yaml` (classical Farneback + EasyOCR) vs `adv.yaml` (CoTracker + PaddleOCR) — TPM data gen defaults to adv.yaml

## Git
- Never push directly to main
- Commit format: type(scope): description — e.g., feat(stageb): add histogram matching
- Run tests and lint before committing: `cd code && python -m pytest tests/ -v && ruff check code/`

## Reference Docs
- For architecture decisions, see docs/architecture.md
- Pipeline diagram: _refs/pipeline.png
- Milestone report: _refs/report.pdf
