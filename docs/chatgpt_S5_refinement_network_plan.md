## Goal

Build a **final-stage ROI alignment refiner** that takes a **slightly misaligned source ROI** and a **target-frame ROI crop containing the same text region**, and predicts a **small residual geometric correction**. The first version should predict a **residual homography** using the standard 8-DoF / 4-corner-offset formulation used in deep homography estimation. A good architectural starting point is a feature extractor + matching/correlation stage + transform regressor, which mirrors established geometric matching designs. ([arXiv][1])

---

## High-level training strategy

Use a **two-stage training pipeline**.

### Stage 1: supervised synthetic pretraining

Generate training pairs on the fly from your existing real text ROI crops by applying **small synthetic perspective perturbations** on a canvas. Because you choose the perturbation, you know the exact target homography. This follows the same general idea as synthetic pair generation in deep homography work. ([arXiv][1])

### Stage 2: self-supervised real-pair fine-tuning

Fine-tune on real neighboring ROIs from the same track, using:

* your existing coarse alignment,
* differentiable warping,
* masked illumination-robust losses,
* and transform regularization.

This is close in spirit to unsupervised deep homography, where training can be driven by image alignment rather than explicit transform labels. ([arXiv][2])

---

# 1. Problem definition

Let:

* `S`: source ROI image
* `T`: target ROI image
* `A`: alpha mask for source ROI support region
* `H0`: coarse initial warp from tracking / box alignment / flow
* `ΔH`: residual homography predicted by the network
* `H = ΔH * H0`

Training objective:

* warp `S` with `H`
* compare warped `S` to `T`
* compare only inside the relevant masked region
* penalize overly large residual transforms

Inference:

* estimate `ΔH` from **original source ROI** and **original target ROI**
* apply `H` to the **edited ROI** afterward

The geometry network should never depend on the edited content.

---

# 2. Dataset generation plan

## 2.1 Source data

Use your existing extracted text ROI tracks.

Per track:

* all ROI images already have the same resolution
* most are roughly horizontal
* neighboring frames represent realistic appearance changes
* tracking is already decent, so the true residual alignment distribution should be small

Store metadata per ROI:

* image path
* track id
* frame index
* width, height
* optional OCR confidence / mask quality score
* optional blur score
* optional text occupancy ratio

## 2.2 Data splits

Split **by track**, not by frame.

Reason:

* frames in the same track are strongly correlated
* frame-level random split will leak content into validation

Recommended:

* 80% train tracks
* 10% val tracks
* 10% test tracks

## 2.3 Two sample types

Use both sample types during training.

### Type A: synthetic self-pairs

Take one ROI image `S`, paste it onto a canvas, then generate a warped partner `T_syn` with a known small homography.

Use this for exact supervision on `ΔH_gt`.

### Type B: real neighboring pairs

Take two frames from the same track, `S` and `T`, with a small temporal gap.

Use this for self-supervised fine-tuning.

Recommended curriculum:

* first mostly Type A
* then mix in Type B
* finally more Type B near the end

---

# 3. Synthetic data generation details

## 3.1 Canvas construction

Do not feed tight crops only. Paste onto a fixed-size canvas.

Suggested:

* ROI resized to fit within `128x128`, `160x160`, or `192x192`
* actual ROI occupies around **60–85%** of the canvas width/height
* keep some margin around it

Why:

* gives the model geometric context
* allows visible displacement after warp
* avoids content being clipped too easily

### Background for canvas

Use one of these:

1. zeros / flat gray
2. lightly randomized noise or blurred color field
3. cropped real background patch from the ROI margins

Best default: flat or low-variance background, but randomize slightly so the model does not overfit to black borders.

## 3.2 Synthetic transform sampling

Sample a **near-identity projective warp**.

Do not train on huge arbitrary homographies. Your deployment problem is residual refinement, not large-baseline matching.

Use corner perturbation parameterization:

* canonical source patch corners: `(0,0), (W,0), (W,H), (0,H)`
* add small offsets to each corner
* solve resulting homography

This follows the 4-point parameterization used in HomographyNet. ([arXiv][1])

### Suggested perturbation ranges

For a `128x128` patch:

* translation: ±4 to ±12 px
* rotation-equivalent effect: small, roughly up to 5–8 degrees
* anisotropic scale: ±5–10%
* perspective corner perturbation: ±4 to ±10 px
* shear: mild only

Use a curriculum:

* early training: smaller perturbations
* later: broaden slightly

## 3.3 Forward sample generation

For one ROI `I`:

1. resize into source patch `P`
2. build source mask `M`

   * if you have a decent alpha/text mask, use it
   * otherwise start with a rectangle mask or a softened occupancy mask
3. paste `P` and `M` into source canvas `Cs`, `Ms`
4. sample residual homography `H_gt`
5. warp `Cs`, `Ms` with `H_gt` to obtain target canvas `Ct`, `Mt`
6. apply independent photometric augmentation to source and target
7. optionally simulate mild blur / compression on one or both sides

Return:

* `source_image = Cs_aug`
* `target_image = Ct_aug`
* `source_mask = Ms`
* `target_mask = Mt`
* label = `Δcorners_gt` or `H_gt`

## 3.4 Photometric augmentation

This matters a lot. Without it, the model will over-rely on exact RGB equality.

Apply mild independent augmentation to source and target:

* brightness jitter
* contrast jitter
* gamma jitter
* saturation shift if using RGB
* mild Gaussian blur / motion blur
* Gaussian noise
* JPEG compression simulation
* slight sharpening sometimes

Keep it realistic. The goal is to simulate:

* illumination changes
* compression
* blur
* camera auto-exposure variation

Do not overdo it or geometry becomes ambiguous.

## 3.5 Occlusion augmentation

Optional but useful:

* small cutout / random erasing near edges
* partial alpha drop
* mild crop truncation

This helps if real tracks sometimes have partial occlusion or crop imperfections.

---

# 4. Real-pair fine-tuning data generation

For each track:

* choose source frame `r`
* choose target frame `t = r + k`, where `k` is small, e.g. 1–5
* optionally include larger `k` later

Inputs:

* `S = ROI_r`
* `T = ROI_t`
* `A = source alpha / support mask`
* `H0` = coarse alignment from your tracker / flow / box-normalization pipeline

Recommended preprocessing:

* first warp `S` with `H0` into target coordinates
* feed the approximately aligned source and the target crop to the network
* network predicts only residual `ΔH`

This residual-around-identity setup should train much more stably than predicting full alignment from scratch.

---

# 5. Network plan

## 5.1 First version to implement

Use:

**shared encoder + correlation + residual homography head**

This is the most suitable first baseline for pairwise geometric alignment and follows the structure used in geometric matching networks: feature extraction, matching, then transform estimation. ([arXiv][3])

## 5.2 Inputs

Recommended input channels:

### Minimal

* source RGB: 3
* target RGB: 3

### Better

* source RGB: 3
* target RGB: 3
* source alpha/support mask: 1

Optional extras:

* warped source edge map
* target edge map
* coarse difference map `|S-T|`
* validity mask after coarse warp

But do not overload the first version.

## 5.3 Pre-alignment

If you already have a coarse alignment:

* pre-warp the source using `H0`
* feed `warp(S, H0)` and `T`

Then the network predicts `ΔH` near identity.

This is preferred over asking the network to discover everything from the raw pair.

## 5.4 Encoder

Use a lightweight CNN.

Example:

* 4–5 downsampling blocks
* channels like 32, 64, 96, 128
* each block: Conv → Norm → ReLU, maybe residual block
* output feature map at 1/4 or 1/8 resolution

You do not need a large backbone first.

## 5.5 Matching layer

Compute explicit matching between source and target feature maps.

Choices:

1. full correlation volume
2. local correlation in a search window
3. concatenation + convs only

Recommended first:

* **local correlation volume** if residual motion is small
* cheaper and well matched to your problem

This is the main reason I prefer this family over a plain U-Net. Explicit matching is the right inductive bias. ([arXiv][3])

## 5.6 Regression head

Take the correlation features and regress:

* `8` parameters = four 2D corner displacements

Then convert corner offsets to homography.

Why this parameterization:

* standard in deep homography
* easier to constrain than raw 3x3 entries
* easier to sample in synthetic generation ([arXiv][1])

## 5.7 Differentiable warp

Use a differentiable homography warp module.

This is conceptually the same role as the spatial transformer idea: predicted transform + differentiable sampling. ([arXiv][4])

Pipeline:

* predict `Δcorners`
* convert to `ΔH`
* compute final `H = ΔH * H0`
* warp source image and source mask
* compute loss

---

# 6. Losses

## 6.1 Stage 1 supervised synthetic loss

Use a combination of:

### Transform regression loss

Primary:

* L1 or smooth L1 on corner offsets

`L_param = smooth_l1(pred_corners, gt_corners)`

Optional:

* also supervise homography matrix normalized by bottom-right entry

### Reconstruction loss

After warping with predicted homography:

* compare warped source to target under mask

This helps tie parameter prediction to actual alignment quality.

Use:

* masked robust L1
* masked gradient loss
* masked SSIM-like loss

## 6.2 Stage 2 self-supervised real loss

No GT transform required.

Use:

### Masked robust photometric loss

Only where warped support mask is valid.

`L_rgb = masked_charbonnier(warp(S,H), T, Aw)`

### Masked gradient loss

Important for lighting robustness.

Compare Sobel / Scharr gradients inside the warped mask.

### Masked structural loss

SSIM or census-style local similarity if easy to implement.

### Residual regularization

Keep `ΔH` near identity.

Example:

* L2 on corner offsets
* or penalty on parameter norm

### Temporal smoothness, optional

If processing sequences in minibatches:

* penalize sudden jumps of predicted `ΔH` across adjacent target frames

## 6.3 Mask usage

Use the **warped source mask** `Aw = warp(A, H)` as the main loss weighting map.

Prefer soft weighting over hard thresholding.

Recommended normalized masked loss:

[
L(x,y,w) = \frac{\sum w \cdot \rho(x-y)}{\sum w + \epsilon}
]

where `ρ` is Charbonnier or robust L1.

## 6.4 Edge weighting trick

Good practical option:

* use one mask for interior appearance loss
* use slightly dilated mask for gradient loss

Why:

* interior is more photometrically stable
* boundaries are more geometrically informative

---

# 7. Training schedule

## Phase A: synthetic supervised pretraining

Train until:

* validation corner error plateaus
* warped alignment is visually stable

Batch composition:

* 100% synthetic pairs

## Phase B: mixed training

Mix:

* 70% synthetic
* 30% real self-supervised

Then gradually move toward:

* 30% synthetic
* 70% real

## Phase C: real-focused fine-tuning

Mainly real neighboring pairs from tracks.

Use lower LR.
Emphasize:

* masked gradient
* masked structural loss
* residual regularization

---

# 8. Inference pipeline

For each source-target pair:

1. get coarse alignment `H0`
2. pre-warp original source ROI with `H0`
3. feed `warp(source_original, H0)`, `target_original`, and source mask
4. predict `ΔH`
5. compute final `H = ΔH * H0`
6. apply final `H` to the **edited ROI**
7. composite into target frame

Important:

* estimate geometry using original content
* apply geometry to edited content later

---

# 9. Evaluation plan

Use both synthetic and real evaluation.

## 9.1 Synthetic metrics

Since GT is known:

* mean corner error
* homography parameter error
* IoU of warped mask
* PSNR / SSIM after warp, secondary only

## 9.2 Real metrics

Since GT is not exact:

* masked gradient error
* masked structural similarity
* temporal smoothness of predicted transforms
* qualitative compositing quality on edited ROIs

## 9.3 Human visual checks

Make side-by-side videos showing:

* coarse alignment only
* coarse + residual refinement
* warped mask overlay
* edge overlay / blink comparison

This will catch failures that scalar metrics miss.

---

# 10. Things to look out for

## 10.1 Train-test mismatch from synthetic warps

Biggest risk: synthetic perturbations are not representative of real residual errors.

Fix:

* estimate the empirical residual range from your real coarse alignments
* sample synthetic corner perturbations from a similar scale distribution

## 10.2 Too much empty canvas

If most of the canvas is blank:

* the model can cheat using borders
* feature matching becomes trivial and unhelpful

Keep ROI large enough in the canvas.

## 10.3 Over-reliance on brightness equality

If augmentations are too weak:

* model learns raw appearance matching
* fails under illumination drift

Use independent appearance augmentation on both branches.

## 10.4 Weak geometric signal from mask interior only

If you only supervise inside flat text interiors:

* transform may be poorly constrained

Add gradient / edge-based losses, and slightly expanded masks around boundaries.

## 10.5 Homography is not always enough

If some tracks involve:

* curved surfaces
* rolling shutter
* crop deformation
* local tracking errors

a single homography may plateau.

Planned upgrade path:

* stage 1 homography
* stage 2 small dense residual flow head

Do not start with this unless needed.

## 10.6 Degenerate source masks

If the alpha/support mask is too rectangular or too loose:

* loss includes background that does not belong to the text support
* gradient signal becomes noisy

Prefer a reasonably tight soft support mask.

## 10.7 Wrong label direction

Be careful with homography direction:

* source-to-target vs target-to-source
* corner coordinates in canvas frame
* composition order `ΔH * H0` vs `H0 * ΔH`

This is a classic implementation bug.

## 10.8 Border artifacts in warping

Warping can create:

* black triangles
* invalid samples
* interpolation blur

Use:

* validity mask from the sampler
* masked normalization in the loss
* consistent interpolation rules

## 10.9 Leakage across splits

If frames from the same track appear in both train and val:

* validation becomes misleadingly optimistic

Split by track only.

## 10.10 Real-pair label noise

Your real ROI pairs are only approximately aligned and may contain:

* blur
* crop jitter
* real content change
* OCR crop inconsistency

That is why supervised synthetic pretraining should come first.

---

# 11. Recommended default hyperparameters

These are starting points, not fixed truths.

## Input

* canvas size: `160x160`
* feature map scale: 1/4 or 1/8
* batch size: as large as GPU allows, maybe 16–64 depending on model size

## Synthetic perturbation

* corner offsets: start around ±6 px on 128-equivalent scale
* later widen to ±10 px if needed

## Loss weights

Start with something like:

* `L_param`: 1.0
* `L_grad`: 1.0
* `L_rgb`: 0.25
* `L_reg`: 0.01 to 0.1 depending on parameter scale
* `L_ssim`: 0.25 if included

Then tune by observing actual alignment quality, not only loss curves.

## Optimization

* AdamW
* LR around `1e-4`
* cosine or step decay
* lower LR for fine-tuning on real pairs

---

# 12. Minimal implementation version

If you want the smallest good first version:

### Data

* only synthetic self-pairs at first
* one ROI crop → canvas → small random 4-corner warp

### Model

* shared CNN encoder
* local correlation volume
* MLP/CNN head
* output 8 corner offsets

### Loss

* smooth L1 on corner offsets
* plus masked gradient reconstruction loss after differentiable warp

### Inference

* predict residual homography on pre-aligned real pair
* apply to edited ROI later

This is enough to validate the whole idea.

---

# 13. Upgrade path

If first version works but not perfectly:

### Upgrade 1

Add real-pair self-supervised fine-tuning.

### Upgrade 2

Add source mask as input channel.

### Upgrade 3

Add multi-scale prediction:

* coarse homography at low resolution
* refine at higher resolution

### Upgrade 4

Add small residual flow head after homography.

### Upgrade 5

Use confidence / occlusion prediction to downweight unreliable regions.

---

# 14. One-paragraph handoff summary for Coding Agent

Implement a residual ROI alignment network for video text editing. Train it first on synthetic pairs generated on the fly from real ROI crops by pasting each crop onto a fixed-size canvas and applying small random 4-corner perspective perturbations; use the known perturbation as ground-truth residual homography. The network should take a roughly aligned source ROI and target ROI crop, extract shared features, compute a correlation/matching representation, and regress 8 corner offsets defining a residual homography. Use differentiable warping and losses on both transform parameters and masked reconstruction quality, with the warped source support mask used to weight the loss. After supervised synthetic pretraining, fine-tune on real neighboring ROI pairs from the same track using masked illumination-robust self-supervised losses and regularization that keeps the residual transform near identity. At inference, estimate the residual transform from the original source/target pair and then apply it to the edited ROI for compositing. This architecture and training recipe are directly aligned with standard deep homography and geometric matching formulations. ([arXiv][1])


[1]: https://arxiv.org/abs/1606.03798?utm_source=chatgpt.com "Deep Image Homography Estimation"
[2]: https://arxiv.org/abs/1709.03966?utm_source=chatgpt.com "Unsupervised Deep Homography: A Fast and Robust Homography Estimation Model"
[3]: https://arxiv.org/abs/1703.05593?utm_source=chatgpt.com "Convolutional neural network architecture for geometric matching"
[4]: https://arxiv.org/abs/1506.02025?utm_source=chatgpt.com "Spatial Transformer Networks"
