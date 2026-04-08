# Changelog

## 2026-04-08 — Expanded ROI with Scene Context (feat/expanded-roi)

### ROI Context Expansion
- Expand the region sent to AnyText2 with real scene pixels from the video frame, giving the model visual context for better style-matching text generation
- Compute expanded warp via translation matrix `T @ H_to_frontal` — reuses existing homography, no S2 changes needed
- AnyText2 mask targets only the text area within the expanded ROI — scene margins provide context but are not edited
- S3 crops the result back to canonical size — S4/S5 see no change

### Configuration
- Add `text_editor.roi_context_expansion` (default 0.0, recommended 0.3) to both `default.yaml` and `adv.yaml`
- Expansion ratio is automatically capped to avoid exceeding AnyText2's 1024px max dimension

### Code Quality
- `BaseTextEditor.edit_text()` ABC gains optional `edit_region` param (backward compatible)
- `PlaceholderTextEditor` respects `edit_region` — renders text only within the specified sub-area
- `AnyText2Editor._prepare_roi()` now returns scale factor for accurate mask coordinate mapping
- `mask_rect` bounds clamped to image dimensions for safety
- AnyText2 dimension constants (`MAX_DIM`, `MIN_DIM`, `ALIGN`) exported as public module-level names — S3 imports instead of duplicating

### Testing
- 15 new tests: `_clamp_expansion_ratio` (6), `_expanded_warp` (3), S3 expansion integration (2), `_prepare_roi` scale return (3), edit_region mask targeting (1)
- 186 tests passing (4 pre-existing failures: missing `wordfreq`)

## 2026-04-08 — BPN Training and TPM Integration into S4 (feat/bpn_model)

### BPN Training Framework (`code/src/models/bpn/`)
- Add Background/Blur Prediction Network from STRIVE: ResNet18 backbone with modified 12-channel first conv (ref + 3 neighbors), GAP + 2 FC head producing per-neighbor `(sigma_x, sigma_y, rho, w)` blur parameters
- Add `DifferentiableBlur` module implementing the oriented anisotropic Gaussian blur kernel from the paper, applied via grouped conv2d for batched per-sample kernels
- Add `BPNDataset` reading aligned ROI sequences from `tpm_dataset/`, with sliding-window sampling, random track subsetting, and a contiguous-array RAM cache that decodes once into a single uint8 ndarray to avoid copy-on-write blowup with DataLoader workers
- Use canonical reference frames from `s1_tracks.json`'s `reference_frame_idx` so every sample in a track shares the same (sharpest) reference instead of arbitrary first-frame-of-window
- Add two-stage training script: Stage 1 supervised on synthetic blur with known parameters, Stage 2 self-supervised reconstruction + temporal consistency on real video tracks
- Combined loss: per-parameter normalized L_psi (Stage 1 only), MSE reconstruction L_R via differentiable blur, and L_T temporal consistency penalty across consecutive neighbors
- Add evaluation script with reconstruction MSE / parameter statistics, training curve plotting, and visualization of one randomly-sampled sample per distinct track with multiple non-consecutive target frames per sample
- Linear warmup + cosine annealing LR scheduler, gradient clipping, periodic and best-val checkpointing, resume from checkpoint
- Initialization fix: small-weight init on the final FC layer so tanh/softplus start in their linear regime instead of saturating into identity output

### S4 Propagation: STRIVE TPM Integration (`code/src/stages/s4_propagation/`)
- Convert `s4_propagation.py` to a package layout (`s4_propagation/stage.py`) to host the multi-file TPM implementation
- Add `LightingCorrectionModule` (paper's LCM): per-pixel multiplicative ratio map between reference and target inpainted backgrounds, applied to the edited reference ROI. Supports log-domain computation, Gaussian smoothing, ratio clipping, distance-weighted neighbor averaging, and EMA temporal smoothing across consecutive frames
- Add `BaseBackgroundInpainter` ABC mirroring `BaseTextEditor` so future inpainters (LaMa, MAT) plug in without changing S4
- Add `SRNetInpainter` concrete backend wrapping `lksshw/SRNet`'s `Generator._bin` subnetwork only, handling the legacy checkpoint's gotchas: `weights_only=False`, lazy `sys.path` injection, RGB color order, `[-1, 1]` normalization, and resize to H=64 with W as a multiple of 8 to match the trained input shape
- Add `BPNPredictor` wrapping the trained BPN + DifferentiableBlur with `predict_params` (one batched forward pass per `n_neighbors` chunk, sigma rescaling from training resolution to inference pixel units) and `apply_blur` (single-image differential blur application)
- New `inpainted_background` field on `TextDetection` carrying the canonical-frontal text-removed ROI between the inpainter and LCM
- Restructure `PropagationStage.run()` into a two-pass loop: first pass collects per-detection lit ROIs (LCM if backgrounds available, else legacy YCrCb histogram matching as fallback), second pass optionally applies BPN differential blur per detection
- Lazy-load both inpainter and BPN on first run when their respective `use_*` flags are set, sharing the loaded models across all tracks/detections
- New `PropagationConfig` knobs: `use_lcm`, `lcm_*` (eps, ratio clip range, smoothing kernel, log-domain, EMA, neighbor self-weight), `inpainter_backend`/`inpainter_checkpoint_path`/`inpainter_device`, `use_bpn`, `bpn_checkpoint_path`/`bpn_device`/`bpn_n_neighbors`/`bpn_image_size`/`bpn_kernel_size`
- `adv.yaml` turns LCM and BPN on by default with the SRNet and BPN-Stage2-final checkpoints

### Smoke Tests
- `test_srnet_inpainter.py` runs SRNet on extracted ROIs and writes side-by-side `(original | inpainted | diff×3)` visualizations
- `test_s4_lcm_e2e.py` plants real ROIs at known quads with multiplicative brightness changes, runs both the histogram baseline and LCM+SRNet paths, and writes per-frame side-by-side comparisons
- `test_s4_bpn_e2e.py` plants ROIs with `cv2.GaussianBlur` at three different sigmas, runs both LCM-only and LCM+BPN, verifying the BPN second pass actually adds visible blur to the heavily-blurred targets

## 2026-04-08 — Test Reorganization & Real E2E Test (feat/anytext2-integration)

### Test Structure
- Reorganize flat 14-file `tests/` directory into tiered layout: `unit/` (6), `stages/` (6), `models/` (1), `integration/` (1)
- Add `pytest.ini` with `--ignore=tests/e2e` default — e2e never runs unless explicitly requested
- Register custom pytest markers: `slow`, `gpu`, `network` for selective test execution

### E2E Tests
- Add `tests/e2e/` with 4 real end-to-end tests exercising full pipeline (PaddleOCR + CoTracker + AnyText2 server) on GPU
- Auto-skip fixtures in `e2e/conftest.py`: gracefully skip on machines without GPU, AnyText2 server, or test video
- Assertions: output video integrity, track detection, non-degenerate AnyText2 ROI, output differs from input
- Run with: `cd code && python -m pytest tests/e2e/ -v`

### Test Counts
- 171 unit/stage/model/integration tests (1.3s)
- 4 real e2e tests (225s on V100)

## 2026-04-07 — AnyText2 ROI Quality Fix (feat/anytext2-integration)

### ROI Resolution & Mask
- Upscale small ROIs so `max(h,w) >= 512` (AnyText2's training resolution) — previously sent at native size (often 256×256 or smaller)
- Pad all dimensions to multiples of 64, matching AnyText2's SD VAE+U-Net architecture — prevents server-side silent pixel cropping via `resize_image()`
- Localize edit mask to the actual text content rectangle (`alpha=255`), padding regions are now anchored (`alpha=0`) — fixes black corner artifacts caused by the model regenerating replicated-border padding
- Crop result to content region before downscaling back to original ROI dimensions

### Configuration
- Add `text_editor.anytext2_min_gen_size` (default 512, range 256–1024) to control the upscale quality floor

### Testing
- Replace 4 old `TestClampDimensions` tests with 12 `TestPrepareRoi` tests covering: upscale, 64-alignment, content rect integrity, border replication, min/max clamping, extreme aspect ratios
- Add `test_localized_mask_written` verifying mask covers only content region
- 29 AnyText2 tests passing, lint clean

## 2026-04-07 — Replace googletrans with deep-translator (feat/anytext2-integration)

### Translation Backend
- Replace `googletrans-py` with `deep-translator` — fixes silent `NoneType` failures on certain inputs (e.g., "WARDEN")
- `GoogleTranslator` as primary backend with automatic `MyMemoryTranslator` fallback — both free, no API key needed
- `deep-translator` raises explicit exceptions (`TranslationNotFound`, `RequestError`) instead of crashing silently
- Update `TranslationConfig.backend` default and both YAML configs from `"googletrans"` to `"deep-translator"`
- 4 translation tests: success, blank-text short-circuit, Google→MyMemory fallback, both-fail-returns-source

## 2026-04-06 — AnyText2 Integration (feat/anytext2-integration)

### Stage A Model
- Integrate AnyText2 (ICLR 2025) as a real Stage A text editing backend, replacing the placeholder for cross-language scene text replacement
- `AnyText2Editor` subclass of `BaseTextEditor` communicates with an external AnyText2 Gradio server via `gradio_client`
- Supports style-preserving editing: uses "Mimic From Image" font extraction and auto-detected text color from the ROI
- Handles ROI dimension clamping (256-1024px range), auto-resize back to original dimensions

### Configuration
- Add `text_editor.server_url`, `server_timeout`, and AnyText2-specific params (`ddim_steps`, `cfg_scale`, `strength`, `img_count`) to `TextEditorConfig`
- `adv.yaml` defaults to `backend: "anytext2"` (server URL must be set per-environment)
- `default.yaml` keeps `backend: "placeholder"` for offline testing

### Testing
- 20 new unit tests for AnyText2Editor: color extraction, dimension clamping, edge cases, mocked Gradio calls, config validation, S3 integration
- All tests run without AnyText2 server (fully mocked)

### E2E Integration Fixes (2026-04-07)
- Fix RGBA mask format: AnyText2 reads edit region from alpha channel, not RGB
- Fix text_prompt quoting: AnyText2's `modify_prompt()` regex requires literal `"text"` wrapping
- Fix Gradio client API: use `submit()` + `job.result(timeout=...)` for gradio_client v2.4
- Fix gallery result parsing: handle image entry as string path (not nested dict)
- Fix CoTracker checkpoint paths: use `../third_party/...` for scripts running from `code/`
- Add connection timeout to Gradio `Client()` constructor via `httpx_kwargs`
- Send `m1` mimic image for proper font style extraction in "Mimic From Image" mode
- Fix typo in diffusion prompt (`"supper"` → `"super"`)

### Misc
- Add `third_party/install_anytext2.sh` for setting up AnyText2 server (clone, conda env, model download)
- Add `gradio_client` to `requirements/base.txt`

## 2026-04-05 — TPM Data Generation Pipeline (experiment/tpm_data_gen)

### Core
- Initial implementation of TPM data generation pipeline (`tpm_data_gen_pipeline.py`, `run_tpm_data_gen_pipeline.py`) with CLI entry point, reusing Stage 1 detection and tracker

### Streaming Architecture (TPM data gen pipeline only)
- Replace all-frames-in-memory loading with a streaming 2-pass pipeline: Pass 1 streams frames for OCR detection/grouping/reference selection, Pass 2 runs per-track optical flow gap-fill + frontalization + ROI extraction (the main translation pipeline still uses the original in-memory approach)
- Add `StreamingDetectionStage` and `StreamingTextTracker` that read frames on demand via `VideoReader`
- Add `CoTrackerOnlineFlowTracker` wrapping the online predictor for chunked tracking with sliding-window GPU memory management

### Detection Improvements
- Add PaddleOCR as a configurable OCR backend alongside EasyOCR (`detection.ocr_backend`)
- Filter gibberish OCR detections using `wordfreq` zipf frequency thresholds
- Add configurable word whitelist (`--word-whitelist` CSV) to bypass gibberish filter for domain-specific text
- Add hard filter for longest text in reference frame selection
- Restrict quad propagation to track's frame range to reduce spurious detections
- Add track break threshold and text similarity check for tracking

### Performance
- Skip redundant seeks for sequential frame reads in `VideoReader` by tracking decoder position
- Replace `iter_frames()` with `read_frame()` at sample_rate intervals to avoid decoding skipped frames
- Add tqdm progress bars to CoTracker online processing and OCR detection loops

### CoTracker Online Fixes
- Rewrite CoTracker online to stream frames forward with overlapping windows matching official `online_demo.py` pattern
- Pad last online chunk when shorter than step×2 to prevent dropped frames
- Keep partially occluded frames (partial occlusion on 4 corners is rarely meaningful)
- Add `max_frame_offset` to `ReferenceSelector` to constrain reference frame to first window of each track

### Configuration
- Add `adv.yaml` with advanced configuration options for CoTracker and PaddleOCR
- Add options to save and load detected tracks from JSON for pipeline debugging
- Update default config path to `adv.yaml` for TPM data gen pipeline

### Misc
- Add PaddleOCR install script (`third_party/`)

## 2026-04-01 — CoTracker Integration (experiment/cotracker)

- Add `flow_fill_strategy` config option: `gaps_only` (original) vs `full_propagation` (overwrite all OCR quads with optical-flow-tracked quads from reference frame)
- Integrate Meta CoTracker3 as a new `optical_flow_method` option, replacing pairwise Farneback/LK with batch point tracking (~25x faster, smoother trajectories)
- Add timing logs for OCR detection and optical flow steps in Stage 1
- Add `third_party/install_cotracker.sh` for cloning and installing CoTracker
