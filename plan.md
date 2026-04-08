# Plan: AnyText2 ROI Resolution & Mask Fix

## Goal
Improve AnyText2 output quality by (1) upscaling small ROIs to 512+ generation resolution with 64-pixel alignment, and (2) restricting the edit mask to the actual text region instead of the full padded image. Eliminates black corner artifacts and low-resolution text.

## Approach
All changes stay within `anytext2_editor.py` + config — no pipeline or S2 changes needed.

**Problem diagnosis:**
- S2 frontalizes text quads into tight ROI crops (e.g., 500×80, 150×40)
- `_clamp_dimensions` pads short axes to 256 with `BORDER_REPLICATE`, but never upscales
- AnyText2 server internally crops to multiples of 64 (`w - (w%64)`) — we don't account for this, silently losing content pixels
- The mask covers 100% of the image (including padding) → AnyText2 tries to regenerate padding regions → black corner artifacts
- AnyText2's training resolution is 512×512 — sending 256×256 is below the sweet spot

**Fix (three parts, all in `anytext2_editor.py`):**

1. **Upscale small ROIs**: If `max(h, w) < min_gen_size` (default 512), uniformly upscale so the longest side reaches `min_gen_size`. This puts the generation resolution in AnyText2's sweet spot.

2. **64-pixel alignment via padding (not cropping)**: After upscaling, round both dimensions UP to the next multiple of 64 using `BORDER_REPLICATE` padding. This replaces the blunt "pad to 256" approach and prevents AnyText2's server-side crop from silently losing content pixels.

3. **Localized mask**: Track padding offsets from step 2. Set mask `alpha=255` only within the original content rectangle; `alpha=0` in padded regions. AnyText2 treats the padding as anchored context and only edits the text area — fixing the black corner artifacts.

**Example flow (150×40 ROI → "GUARDIA"):**
```
Input ROI:     150×40
Upscale (×3.41): 512×137
64-align pad:  512×256  (137→192 for 64-align, 192→256 for _MIN_DIM)
               (pad 59 top, 60 bottom)

Mask:          512×256
               [alpha=0  ] ← 59px top padding (anchored)
               [alpha=255] ← 137px content (edit region)
               [alpha=0  ] ← 60px bottom padding (anchored)

AnyText2 server: resize_image(512×256, max_length=1024)
  → 512-(512%64)=512, 256-(256%64)=256 → 512×256 (no crop! dimensions preserved)

Result:        512×256 → crop out padding → 512×137 → downscale to 150×40
```

**Key decisions:**
- **Upscale target 512 (not 768/1024)**: 512 is AnyText2's default training resolution. Higher values have diminishing returns and increase latency quadratically.
- **Pad to 64-multiples (not crop)**: AnyText2 server crops to 64-multiples. By pre-aligning via padding, we ensure zero content pixel loss and our mask stays in sync with what the server actually processes.
- **BORDER_REPLICATE for padding**: Same as before — replicates edge pixels, giving AnyText2 a plausible "background" in the anchored region.
- **Configurable `anytext2_min_gen_size`**: Allows tuning per deployment. Default 512, range 256–1024.
- **Return value crops padding before downscale**: The result from AnyText2 includes the padded region (which should be unchanged). We crop to the content rectangle first, then downscale to original dimensions. This avoids blending padding artifacts into the final output.

## Files to Change
- [ ] `code/src/config.py` — Add `anytext2_min_gen_size: int = 512` to `TextEditorConfig`
- [ ] `code/src/models/anytext2_editor.py` — Refactor `_clamp_dimensions` → `_prepare_roi` (upscale + 64-align + return padding offsets); update mask creation to be localized; crop result before downscale
- [ ] `code/config/default.yaml` — Add `anytext2_min_gen_size: 512` to `text_editor` section
- [ ] `code/config/adv.yaml` — Same
- [ ] `code/tests/test_anytext2_editor.py` — Update existing clamp tests, add tests for upscale, 64-alignment, localized mask, result cropping

## Risks
- **VRAM increase**: 512×512 uses ~4× compute vs 256×256. Should be fine on a 12GB+ GPU with `img_count=1`, but worth monitoring.
- **Latency**: ~1.5–2s per track instead of ~1.2s. Acceptable for reference-frame-only editing.
- **Padding as context quality**: `BORDER_REPLICATE` padding is still artificial. It's better than masking it for edit, but AnyText2 may still produce minor artifacts at the content/padding boundary. **Future improvement (Option C)**: expand the ROI in S2 to include real scene context from the original frame before frontalization. This would require S2 pipeline changes and is deferred.
- **Aspect ratio extremes**: Very wide text (e.g., 1000×30) upscaled → 512×15 → padded to 512×64. The content strip is thin relative to padding. Quality may still be limited for extreme aspect ratios.
- **Double-resize for upscaled ROIs**: Upscale (Lanczos) → AnyText2 generates → crop → downscale (Lanczos). Two resampling passes. Acceptable for diffusion model output which isn't pixel-perfect anyway.

## Done When
- [ ] Small ROIs (e.g., 150×40) are upscaled to 512+ before hitting AnyText2
- [ ] All dimensions sent to AnyText2 are multiples of 64 (no server-side pixel loss)
- [ ] Mask covers only the text content region, not padding — no more black corner artifacts
- [ ] Result is cropped to content region before downscaling to original ROI dimensions
- [ ] Config field `anytext2_min_gen_size` is respected and documented in YAML files
- [ ] All existing tests pass (zero regressions)
- [ ] New tests cover: upscale path, 64-alignment, localized mask shape, result crop, edge cases (already-large ROIs, extreme aspect ratios)

## Progress
- [x] Step 1: Add `anytext2_min_gen_size` config field
- [x] Step 2: Refactor `_clamp_dimensions` → `_prepare_roi` (upscale + 64-align + return offsets)
- [x] Step 3: Update mask creation to use localized mask based on padding offsets
- [x] Step 4: Crop AnyText2 result to content region before downscaling
- [x] Step 5: Update `default.yaml` and `adv.yaml`
- [x] Step 6: Update tests (fix existing clamp tests, add new coverage)
- [x] Step 7: Code review — fixed misleading mock size, added _MIN_DIM invariant comment, explicit fixture config
