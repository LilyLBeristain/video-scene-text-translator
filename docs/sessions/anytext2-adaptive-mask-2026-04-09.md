# Session: AnyText2 Adaptive Mask Sizing — 2026-04-09

## Completed
- Researched the root cause: AnyText2 (and every other mask-based STE model) gibberish-fills when target text aspect ≪ source mask aspect. GLASTE (CVPR 2024) is the only paper that solves it architecturally; inference-time workarounds are not discussed in the literature.
- Designed and implemented Option B (partial inpaint + middle-strip preservation) on branch `fix/anytext2-adaptive-mask`. 5 atomic commits landed on top of master.
- Added 3 pure helpers (`estimate_target_width`, `compute_adaptive_mask_rect`, `restore_middle_strip`) in new `code/src/models/anytext2_mask.py`, fully unit-tested (42 tests).
- Wired the flow into `AnyText2Editor` (new `_apply_adaptive_mask`) and `TextEditingStage` (lazy `_get_inpainter` reusing propagation config as a separate instance, D5 decoupled).
- 52 new tests total (42 unit + 10 integration with mock inpainter/gradio). Full suite: 230 passing, same 8 pre-existing failures as master. Ruff clean on all changed files.
- @reviewer pass: 1 "blocker" was a false positive (arithmetic error in reviewer's own trace), verified empirically and converted into 2 regression tests. 2 nits fixed (yaml comment, S3/S4 asymmetry docstring). Docs updated: `architecture.md` + `plan.md`.

## Current State
- Branch `fix/anytext2-adaptive-mask` has 5 commits ahead of master, working tree clean.
- AnyText2 adaptive mask is **on by default** in both yaml configs but is a no-op unless `backend=anytext2` AND `propagation.inpainter_backend` is set.
- No behavioural change for placeholder backend users. No behavioural change for AnyText2 users whose source/target aspects are within 15% tolerance.
- Pre-existing master failures (4 PaddleOCR, 4 S5 Poisson) are unchanged — they predate this branch.

## Next Steps
1. **Manual e2e on GPU (deferred from Step 13)** — see "E2E Test Instructions" below. Required before opening PR to master.
2. Open PR from `fix/anytext2-adaptive-mask` → `master`.
3. After merge, monitor for the R1 concern (middle-strip cutting through characters) on real videos.

## E2E Test Instructions

Run on the GPU box with the AnyText2 Gradio server up and `propagation.inpainter_backend: "srnet"` configured in `adv.yaml`. Two test cases cover the tolerance fast-path + the adaptive trigger path:

### Test 1 — Normal case (EN → ES, aspects similar)
Target: verify the tolerance fast-path kicks in, **no inpaint runs**, behaviour is identical to pre-PR.

```bash
eval "$(/opt/miniconda3/bin/conda shell.bash hook)" && conda activate vc_final

# Start AnyText2 server in another terminal if not already running:
#   bash third_party/install_anytext2.sh serve

python scripts/run_pipeline.py \
    --config code/config/adv.yaml \
    --input <path-to-normal-en-video> \
    --output /tmp/anytext2_normal_en_es.mp4 \
    --source-lang en --target-lang es
```

Expected:
- Log shows `S3: Editing text for N tracks using 'anytext2' backend`
- Log does **NOT** show any `AnyText2 adaptive mask triggered` lines (aspect mismatch < 15% for most en→es translations since Latin-to-Latin keeps similar visual width)
- Log does **NOT** show `SRNet inpainter` being loaded in S3 (lazy-load, only triggers when adaptive fires)
- Output video looks identical to a pre-PR run — this is the regression guard

### Test 2 — Short case (EN → ZH, long→short aspect mismatch)
Target: exercise the adaptive mask flow. Should trigger on most tracks since ZH chars are full-width but EN words are half-width, so ZH translations are typically much narrower than the EN source bbox.

```bash
python scripts/run_pipeline.py \
    --config code/config/adv.yaml \
    --input <path-to-english-signboard-video> \
    --output /tmp/anytext2_short_en_zh.mp4 \
    --source-lang en --target-lang zh-cn
```

Expected:
- Log shows `S3: loading SRNet inpainter for AnyText2 adaptive mask from <ckpt path>` (once on first long→short track)
- Log shows `AnyText2 adaptive mask triggered: canonical WxH → mask width X (centered), target_text=...` on tracks where source is long English and target is short CJK
- No gibberish characters filling the empty mask area
- New CJK text should be **centered** inside the original English text bbox location, with clean (inpainted) background on the sides
- Check for R1 artifacts: does the middle-strip cut through half of a character in a way that visibly hurts font matching? If yes, note which track and file a follow-up.
- Check for R2 artifacts: any visible seam at the feather boundary between the inpainted edges and the middle strip?

### What to do if adaptive mask makes things worse
1. Set `text_editor.anytext2_adaptive_mask: false` in adv.yaml → restores pre-PR behaviour completely
2. Or tune `anytext2_mask_aspect_tolerance: 0.30` to make the fast-path more aggressive (fewer triggers)
3. Or tune `anytext2_mask_min_ratio: 0.40` to prevent very narrow masks

## Decisions Made
- **Option B over Option A (m1/ref_img decoupling)**: middle strip preserves font style via AnyText2's standard Mimic-From-Image mode, no API behaviour speculation needed. A is a fallback if B's middle-strip-too-thin cases turn out problematic.
- **Character-class heuristic over PIL font measurement**: zero font dependencies, ±15% accuracy is enough because of the downstream tolerance check.
- **S3/S4 decoupled inpainter instances**: each stage lazy-loads its own, no `TextDetection.inpainted_background` cross-stage cache. Costs ~200 ms/track extra GPU, buys clean stage boundaries. Cache-sharing optimization deferred.
- **S3's `_get_inpainter` is permissive** (warn + None) while **S4's is strict** (raise): S3's inpainter is an optional quality optimization, S4's is core LCM. Deliberate asymmetry documented in the S3 docstring.
- **Text color extraction moved BEFORE adaptive mask**: must read original pixels, not inpainted background. This is easy to break — keep the ordering assertion in mind when editing `edit_text`.
- **Reviewer's B1 was a false positive**: the feather math is symmetric and correct at both canvas edges. Turned the concern into a permanent regression test instead of a code change.

## Open Questions
- Does the middle strip actually provide enough font signal when it only contains 2–3 source characters (extreme long→short cases like 10:1 → 2:1)? Only answerable by running Test 2 above on a real video.
- Should Test 2's output be compared against a run with `anytext2_adaptive_mask: false` as an A/B sanity check? Recommend capturing both for the first real video so we can see what the fix actually changed.
- If e2e reveals the middle strip is too thin to be useful on real videos, the fallback is Option A (decouple m1 from ref_img) — would be a new PR, not a tweak to this one.
