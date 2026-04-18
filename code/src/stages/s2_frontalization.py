"""Stage 2: Frontalization.

Computes homography from each frame's quad to a canonical frontal
rectangle and stores the matrices in TextDetection fields.

Optionally runs the ROI alignment refiner on each (reference, target)
canonical ROI pair and folds the predicted residual homography (ΔH)
into ``H_to_frontal`` / ``H_from_frontal`` so all downstream stages see
pre-aligned canonical ROIs. See docs/s2_refiner_migration_plan.md for
the direction derivation.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from src.config import PipelineConfig
from src.data_types import TextTrack
from src.stages.s5_revert.refiner import RefinerInference
from src.utils.geometry import canonical_rect_from_quad, compute_homography

logger = logging.getLogger(__name__)


class FrontalizationStage:
    def __init__(self, config: PipelineConfig):
        self.config = config.frontalization
        self._refiner: RefinerInference | None = None
        if self.config.use_refiner:
            self._refiner = RefinerInference(
                checkpoint_path=self.config.refiner_checkpoint_path,
                device=self.config.refiner_device,
                image_size=tuple(self.config.refiner_image_size),
                max_corner_offset_px=self.config.refiner_max_corner_offset_px,
                use_gate=self.config.use_refiner_gate,
                score_margin=self.config.refiner_score_margin,
            )

    def compute_homographies(
        self,
        track: TextTrack,
        frames: dict[int, np.ndarray] | None = None,
    ) -> tuple[int, int]:
        """Compute homography from each frame's quad to the canonical rect.

        Writes H_to_frontal and H_from_frontal directly into each
        TextDetection. Also sets track.canonical_size.

        The canonical rectangle is derived from the reference quad's
        dimensions (average edge lengths), and all frames map to this
        same canonical space.

        When the refiner is enabled and ``frames`` is provided, each
        non-reference detection's homography is corrected by folding the
        predicted ΔH into ``H_to_frontal``:
        ``H_to_frontal_corrected = inv(ΔH) @ H_to_frontal``. Predictions
        that fail sanity checks leave the unrefined baseline in place.

        Returns:
            ``(refine_total, refine_rejected)`` counters for the track's
            refined calls. ``(0, 0)`` when the refiner is disabled.
        """
        if track.reference_quad is None:
            logger.warning(
                "Track %d has no reference quad, skipping", track.track_id
            )
            return 0, 0

        try:
            dst_points, canonical_size = canonical_rect_from_quad(
                track.reference_quad
            )
        except ValueError:
            logger.warning(
                "Track %d has degenerate reference quad, skipping",
                track.track_id,
            )
            return 0, 0

        track.canonical_size = canonical_size

        refine_total = 0
        refine_rejected = 0

        # Reference canonical ROI, warped once per track when refinement
        # is active. None when the refiner is disabled, the reference
        # homography is invalid, or the reference frame is unavailable.
        ref_canonical: np.ndarray | None = None
        ref_idx = track.reference_frame_idx

        for frame_idx, det in track.detections.items():
            grid = det.tracked_grid_points
            if grid is not None and grid.shape[0] > 4:
                # Multi-point homography fitting: use all tracked grid
                # points (4 corners + N×N interior) for a least-squares /
                # RANSAC fit. Generate matching destination grid points on
                # the canonical rectangle using the same bilinear layout.
                from src.stages.s1_detection.tracker import generate_quad_grid

                grid_size = int(round((grid.shape[0] - 4) ** 0.5))
                dst_grid = generate_quad_grid(dst_points, grid_size)
                src_pts = grid
                dst_pts = dst_grid
            else:
                src_pts = det.quad.points
                dst_pts = dst_points

            H_to_frontal, H_from_frontal, is_valid = compute_homography(
                src_points=src_pts,
                dst_points=dst_pts,
                method=self.config.homography_method,
                ransac_threshold=self.config.ransac_reproj_threshold,
            )
            det.H_to_frontal = H_to_frontal
            det.H_from_frontal = H_from_frontal
            det.homography_valid = is_valid

            # Refinement: skip the reference frame (it aligns to itself)
            # and skip when we have no frames or invalid baseline.
            if self._refiner is None or frames is None:
                continue
            if not is_valid or H_to_frontal is None or H_from_frontal is None:
                continue
            if frame_idx == ref_idx:
                continue

            # Lazy-build the reference canonical ROI once per track.
            if ref_canonical is None:
                ref_frame = frames.get(ref_idx)
                ref_det = track.detections.get(ref_idx)
                if (ref_frame is None
                        or ref_det is None
                        or not ref_det.homography_valid
                        or ref_det.H_to_frontal is None):
                    # No viable reference — disable refinement for the
                    # rest of this track by short-circuiting the check.
                    ref_canonical = np.empty((0,), dtype=np.uint8)
                    continue
                try:
                    ref_canonical = cv2.warpPerspective(
                        ref_frame,
                        ref_det.H_to_frontal,
                        canonical_size,
                    )
                except cv2.error:
                    ref_canonical = np.empty((0,), dtype=np.uint8)
                    continue
                if ref_canonical.size == 0:
                    continue
            elif ref_canonical.size == 0:
                continue

            target_frame = frames.get(frame_idx)
            if target_frame is None:
                continue
            try:
                target_canonical = cv2.warpPerspective(
                    target_frame, H_to_frontal, canonical_size,
                )
            except cv2.error:
                continue
            if target_canonical.size == 0:
                continue

            refine_total += 1
            try:
                delta_H = self._refiner.predict_delta_H(
                    ref_canonical, target_canonical,
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "S2 refiner: predict_delta_H raised %s; falling back "
                    "to identity", exc,
                )
                delta_H = None

            if delta_H is None:
                refine_rejected += 1
                continue

            # Direction convention (see plan):
            #   H_to_frontal_corrected   = inv(ΔH) @ H_to_frontal
            #   H_from_frontal_corrected = H_from_frontal @ ΔH
            try:
                delta_H_inv = np.linalg.inv(delta_H)
            except np.linalg.LinAlgError:
                refine_rejected += 1
                continue

            det.H_to_frontal = delta_H_inv @ H_to_frontal
            det.H_from_frontal = H_from_frontal @ delta_H

        return refine_total, refine_rejected

    def run(
        self,
        tracks: list[TextTrack],
        frames: dict[int, np.ndarray] | None = None,
    ) -> list[TextTrack]:
        """Compute canonical homographies for all tracks.

        Args:
            tracks: TextTracks with dense detections (gap-filled by S1).
            frames: Frame dict keyed by frame index. Required when
                ``frontalization.use_refiner`` is True; ignored otherwise.

        Returns:
            Same tracks with homography fields populated on each detection.
        """
        logger.info("S2: Computing frontalization for %d tracks", len(tracks))

        total_total = 0
        total_rejected = 0
        for track in tracks:
            t_total, t_rej = self.compute_homographies(track, frames=frames)
            total_total += t_total
            total_rejected += t_rej

        if self._refiner is not None and total_total > 0:
            rejection_rate = total_rejected / total_total
            msg = "S2 refiner: %d / %d predictions rejected (%.1f%%)"
            args = (total_rejected, total_total, rejection_rate * 100.0)
            if rejection_rate >= self.config.refiner_rejection_warn_threshold:
                logger.info(msg, *args)
            else:
                logger.debug(msg, *args)

        return tracks
