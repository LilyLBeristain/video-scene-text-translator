# Plan: Move Alignment Refiner to S2 (Frontalization)

## Goal

Integrate the trained ROI alignment refiner into **S2 Frontalization**, baking
the residual ΔH into each frame's `H_to_frontal` / `H_from_frontal` so that
all downstream stages (S3 editing, S4 LCM/BPN/histogram, S5 composite) see
pre-aligned canonical ROIs.

The existing S5 refiner stays in place as a fallback and is turned off via
config. No S5 code is removed in this plan.

## Why S2 is the right stage

- **Semantic fit**: S2's job is "geometric alignment from frame quad to
  canonical space." The refiner is a geometric correction. It belongs here.
- **Uniform downstream benefit**: S4's LCM computes a per-pixel ratio map
  between `ref_canonical` and `target_canonical`. That map is only
  meaningful when the two inputs are pixel-aligned. Today they aren't,
  because CoTracker drift means `target_canonical` is slightly off from
  `ref_canonical`. Correcting at S2 gives LCM properly aligned inputs —
  a real quality improvement, not just visual smoothing.
- **BPN** similarly benefits from aligned ref/target canonicals.
- **S5** gets the same benefit it does today (refined composite position)
  but without needing to carry `target_roi_canonical` through
  `PropagatedROI` — the refiner has already done its job upstream.

## Direction convention (worked out)

The S5 refiner already establishes: `ΔH` is a forward homography in canonical
pixel space mapping **ref-canonical → target-canonical**. Training contract:
`warp_image(ref_canonical, ΔH) ≈ target_canonical`.

At S2, we want to **fold that ΔH into H_to_frontal** so downstream stages
see corrected canonical ROIs. Derivation:

- Unrefined: `p_tgt_canonical = H_to_frontal @ p_frame` — but `p_tgt_canonical`
  lives in target-canonical coords (subject to drift), not ref-canonical.
- We want `H_to_frontal_corrected` such that
  `p_ref_canonical = H_to_frontal_corrected @ p_frame`.
- Chain: `p_ref_canonical = inv(ΔH) @ p_tgt_canonical = inv(ΔH) @ H_to_frontal @ p_frame`.
- Therefore: **`H_to_frontal_corrected = inv(ΔH) @ H_to_frontal`**.
- And: `H_from_frontal_corrected = inv(H_to_frontal_corrected) = H_from_frontal @ ΔH`.

Sanity check: with this correction, S5's current composition
`T @ H_from_frontal @ ΔH` becomes `T @ H_from_frontal_corrected` — **S5
needs no composition change at all** when S2 is doing the correction.
The S5 refiner path can stay intact; it just won't fire when its config
switch is off.

## Two-layer concern

With both S2 and S5 refiners enabled, we'd apply ΔH twice (once baked into
`H_to_frontal`, once composed at S5 warp time). Resolution:

- **Validator rule**: `use_refiner` in both `FrontalizationConfig` and
  `RevertConfig` → raise a config error. Force users to pick one.
- Default: `frontalization.use_refiner: true`, `revert.use_refiner: false`.

## Architecture changes

### Pipeline signature

`FrontalizationStage.run(tracks)` → `run(tracks, frames)`. One call site
in `pipeline.py` to update.

### FrontalizationStage

New constructor parameter receiving the full `PipelineConfig` so S2 can
access `frontalization.refiner_*` fields. Lazy-construct
`RefinerInference` the same way S5 does.

Refined loop:

```python
for track in tracks:
    # Unrefined homography for reference frame (always)
    ref_H_to_frontal, ref_H_from_frontal, ref_valid = compute_homography(
        ref_det.quad.points, dst_points, ...
    )
    ref_det.H_to_frontal = ref_H_to_frontal
    ref_det.H_from_frontal = ref_H_from_frontal
    ref_det.homography_valid = ref_valid

    # Pre-compute ref_canonical once per track
    ref_canonical = cv2.warpPerspective(
        frames[ref_idx], ref_H_to_frontal, canonical_size,
    )

    for frame_idx, det in track.detections.items():
        if frame_idx == ref_idx:
            continue

        # Unrefined homography
        H_to_frontal, H_from_frontal, is_valid = compute_homography(...)
        det.H_to_frontal = H_to_frontal
        det.H_from_frontal = H_from_frontal
        det.homography_valid = is_valid

        # Refinement
        if self._refiner is not None and is_valid:
            target_canonical = cv2.warpPerspective(
                frames[frame_idx], H_to_frontal, canonical_size,
            )
            delta_H = self._refiner.predict_delta_H(
                ref_canonical, target_canonical,
            )
            if delta_H is not None:
                det.H_to_frontal = np.linalg.inv(delta_H) @ H_to_frontal
                det.H_from_frontal = H_from_frontal @ delta_H
```

### Config

Add to `FrontalizationConfig` (mirror the `RevertConfig` refiner block):

```python
use_refiner: bool = False
refiner_checkpoint_path: str = "checkpoints/refiner/refiner_v0.pt"
refiner_device: str = "cuda"
refiner_image_size: tuple[int, int] = (64, 128)
refiner_max_corner_offset_px: float = 16.0
refiner_rejection_warn_threshold: float = 0.1
use_refiner_gate: bool = True
refiner_score_margin: float = 0.01
```

New validation rules in `PipelineConfig.validate()`:

- If `frontalization.use_refiner` and `revert.use_refiner` are both True →
  error "pick one".
- Same validation rules as the existing S5 refiner (non-empty checkpoint,
  reasonable margins, positive offset).
- If `frontalization.use_refiner` → `propagation.save_target_canonical_roi`
  is **not** required (that flag is a S5-refiner-specific need).

### adv.yaml

- Add `frontalization.use_refiner: true` plus the other refiner fields.
- Flip `revert.use_refiner: false`.
- Leave `revert.refiner_*` fields in place so the switch can be flipped
  for A/B comparison without editing multiple files.

## Files to change

- [ ] `code/src/config.py` — new `FrontalizationConfig.refiner_*` fields,
  updated `validate()` with the "not both" rule.
- [ ] `code/src/stages/s2_frontalization.py` — accept `frames`, lazy-load
  `RefinerInference`, new refined loop.
- [ ] `code/src/pipeline.py` — pass `frames` into `s2.run()`.
- [ ] `code/config/adv.yaml` — move refiner config from `revert:` to
  `frontalization:`; flip switches.
- [ ] `code/config/default.yaml` — no change (refiner off by default).
- [ ] `code/tests/stages/test_s2_frontalization.py` — new tests for the
  refiner integration:
  - Refiner disabled → no behavior change (backward-compat pin).
  - Refiner enabled with a fake refiner → `H_to_frontal` is updated to
    `inv(ΔH) @ H_to_frontal_unrefined` for non-reference frames.
  - Reference frame is skipped (not passed through the refiner).
  - Refiner returns `None` (rejection) → homography is the unrefined
    baseline.
  - **Direction pinning test**: feed a known ΔH via mock, verify that
    the corrected `H_to_frontal` maps a feature at the expected
    ref-canonical position.
- [ ] `code/tests/unit/test_config.py` — validation rule for "not both".

## Done when

- [ ] All existing tests pass.
- [ ] New S2 tests pass, including the direction pinning test.
- [ ] Full-video ablation on `real_video15` with
  `frontalization.use_refiner: true` produces output visually
  comparable or better than the current S5-refiner setup.
- [ ] `revert.use_refiner: false` in adv.yaml — S5 refiner code path is
  cold, verified by log output not showing "S5 refiner: loading ...".

## Risks

- **Direction bugs** — the new composition `inv(ΔH) @ H_to_frontal` is
  subtle. The pinning test in `test_s2_frontalization.py` must pass
  before we trust anything else.
- **Memory** — S2 now warps full frames through each unrefined
  `H_to_frontal` to produce `target_canonical` as a refiner input. At
  1920×1080 × canonical_size × num_frames per track, this is within
  normal pipeline memory budgets but worth watching on very long videos.
  Mitigation: only compute `target_canonical` lazily (right before the
  refiner call, discarded after).
- **Refiner on reference frame** — skipped explicitly. If the reference
  is mis-flagged somehow, the refiner would run on (ref, ref) and
  predict ~0 anyway. Low-risk.
- **S5 fallback semantics** — when S2 refiner is on, S5 still reads
  `prop_roi.target_roi_canonical` if `save_target_canonical_roi` is
  True. S4's population of that field becomes wasted work. Acceptable
  for now (user's instruction: keep S5 intact); could gate the S4
  population on `revert.use_refiner` in a later cleanup.

## Rollout

1. Implement + unit tests.
2. Full-suite test run.
3. Visual ablation on `real_video15` and one harder video
   (maybe `real_video0` or another with more motion). Compare S2 refiner
   vs. S5 refiner vs. no refiner. Save outputs to
   `saved_videos/s2_refiner_ablation/`.
4. If S2 refiner is neutral-or-better on both videos → ship it by
   updating `adv.yaml` defaults. If worse on either, keep the switch
   off and investigate.
